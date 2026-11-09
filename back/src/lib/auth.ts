import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { captcha, genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { users, oauthAccounts, sessions, authVerifications } from "../db/schema";
import { config } from "../config";
import { isAllowedCorsOrigin } from "./corsConfig";
import { renderEmailTemplate } from "../email/templateRenderer";
import { sendEmail } from "../services/emailService";
import { registerSchema } from "../../../shared/validation/schemas";
import { SYNTHETIC_EMAIL_DOMAIN } from "@shared/types";

const frontendURL = process.env.FRONTEND_URL ?? "http://localhost:5173";

export const auth = betterAuth({
  appName: "Urbanist Map",
  baseURL: process.env.VITE_API_BASE_URL || frontendURL,
  secret: config.COOKIE_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      account: oauthAccounts,
      session: sessions,
      verification: authVerifications,
    },
    transaction: true,
  }),
  trustedOrigins(request) {
    const origin = request?.headers.get("origin");
    return origin && isAllowedCorsOrigin(origin) ? [frontendURL, origin] : [frontendURL];
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 5 },
      "/request-password-reset": { window: 3600, max: 5 },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    defaultCookieAttributes: {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: process.env.NODE_ENV === "development" ? "lax" : "none",
    },
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
  },
  user: { fields: { name: "username" } },
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  account: {
    fields: { providerId: "provider", accountId: "providerAccountId" },
    encryptOAuthTokens: true,
    storeStateStrategy: "database",
    accountLinking: { enabled: true, trustedProviders: [] },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: (password) => Bun.password.hash(password),
      verify: ({ hash, password }) => Bun.password.verify(password, hash),
    },
    async sendResetPassword({ user, url }) {
      const message = await renderEmailTemplate("passwordReset", { resetUrl: url });
      await sendEmail(user.email, message.subject, message.html);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, token }) {
      const verificationUrl = `${frontendURL}/verify?token=${encodeURIComponent(token)}`;
      const message = await renderEmailTemplate("verification", { verificationUrl });
      await sendEmail(user.email, message.subject, message.html);
    },
  },
  onAPIError: { errorURL: `${frontendURL}/` },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "osm",
          clientId: process.env.OSM_CLIENT_ID ?? "",
          clientSecret: process.env.OSM_CLIENT_SECRET,
          authorizationUrl: "https://www.openstreetmap.org/oauth2/authorize",
          tokenUrl: "https://www.openstreetmap.org/oauth2/token",
          userInfoUrl: "https://www.openstreetmap.org/oauth2/userinfo",
          scopes: ["openid"],
          pkce: true,
          accountSubject: ({ profile }) => String(profile.sub),
          mapProfileToUser(profile) {
            if (typeof profile.sub !== "string" || !/^\d+$/.test(profile.sub)) {
              throw new APIError("BAD_REQUEST", { message: "Invalid OSM identity" });
            }
            return {
              name:
                typeof profile.preferred_username === "string"
                  ? profile.preferred_username
                  : `osm_${profile.sub}`,
              email: `osm-${profile.sub}@${SYNTHETIC_EMAIL_DOMAIN}`,
              emailVerified: true,
            };
          },
        },
      ],
    }),
    ...(process.env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: process.env.TURNSTILE_SECRET_KEY,
            endpoints: ["/sign-up/email"],
          }),
        ]
      : []),
  ],
  databaseHooks: {
    user: {
      create: {
        async before(user, context) {
          const isEmailSignUp = context?.path === "/sign-up/email";
          if (isEmailSignUp) {
            const validation = registerSchema.shape.username.safeParse(user.name);
            if (!validation.success)
              throw new APIError("BAD_REQUEST", { message: validation.error.issues[0]?.message });
          }
          const [existing] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, user.name));
          if (!existing) return;
          if (isEmailSignUp)
            throw new APIError("CONFLICT", {
              code: "USERNAME_TAKEN",
              message: "auth.error.usernameTaken",
            });
          // Display names remain unique; provider identity is always the stable subject.
          return {
            data: {
              ...user,
              name: `${user.name.slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`,
            },
          };
        },
      },
    },
    session: {
      create: {
        async before(session) {
          const [user] = await db
            .select({ banned: users.banned })
            .from(users)
            .where(eq(users.id, session.userId));
          if (!user || user.banned)
            throw new APIError("FORBIDDEN", {
              code: "USER_BANNED",
              message: "auth.error.invalidCredentials",
            });
        },
      },
    },
  },
});

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
