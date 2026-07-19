import { Hono, type Context } from "hono";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { users, config } from "../db/schema";
import * as rateLimit from "../lib/rateLimit";
import { resolveSessionUser } from "../lib/currentUser";
import { getClientIp } from "../utils/ip";
import { verifyGoogleToken } from "../utils/googleAuth";
import { findOrCreateOAuthUser } from "../utils/oauthAccounts";
import { buildOsmAuthorizeUrl, exchangeOsmCodeForUser, isOsmConfigured } from "../utils/osmAuth";
import { SYNTHETIC_EMAIL_DOMAIN } from "@shared/types";
import type { AppEnv, SessionUser } from "../lib/types";

// Cookie-session HTTP endpoints (login, OAuth, logout, session check).
// The tRPC account router (./account) covers registration/verification/reset.
export const authApp = new Hono<AppEnv>();

// Session duration constants
const SESSION_DURATION_SHORT = 7 * 24 * 60 * 60; // 7 days for regular login
export const SESSION_DURATION_LONG = 30 * 24 * 60 * 60; // 30 days for "Remember Me"

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

// Enforce a minimum execution time to mitigate timing attacks
async function enforceMinExecutionTime(startTime: number) {
  const MIN_EXEC_TIME = 200; // 200ms target duration
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_EXEC_TIME) {
    await Bun.sleep(MIN_EXEC_TIME - elapsed);
  }
}

function setUserSession(c: Context<AppEnv>, user: SessionUser, rememberMe: boolean) {
  const session = c.get("session");

  const sessionDuration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION_SHORT;
  const expiresAt = new Date(Date.now() + sessionDuration * 1000);

  session.set("user", {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    moderatedCountries: user.moderatedCountries,
    emailVerified: user.emailVerified,
  });

  session.set("expiresAt", expiresAt.toISOString());
}

async function validateGoogleLoginRequest(body: unknown) {
  const googleLoginSchema = z.object({
    token: z.string().min(1, "Google token is required"),
    rememberMe: z.boolean().optional().default(false),
  });

  const validationResult = googleLoginSchema.safeParse(body);
  if (!validationResult.success) {
    const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
    throw Object.assign(new Error(errorMessage), { statusCode: 400 });
  }

  return validationResult.data;
}

authApp.post("/api/login", async (c) => {
  // Measure start time to enforce constant time response
  const startTime = Date.now();

  try {
    // Rate limit: 10 attempts per IP per minute
    const ip = getClientIp(c);
    if (!rateLimit.check(ip, 10, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    const body = await c.req.json();

    // Validate request body with Zod
    const validationResult = loginSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage }, 400);
    }

    const { email, password, rememberMe } = validationResult.data;

    // Find user (same logic as tRPC route)
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // SECURITY: Mitigate timing attack
    // Always perform password verification even if user doesn't exist
    // This ensures consistent response time (~80ms) for both valid and invalid emails
    const dummyHash =
      "$argon2id$v=19$m=65536,t=2,p=1$WzgfyslW80m4IOmzoEo0MiRnRnyqnFVzaFLp/S1kQIQ$RO1WV3KLiIMekWVluRf8a2oDncmEoVmUPD9MCN1wMd4";
    const targetHash = user?.passwordHash ?? dummyHash;

    // Verify password (always executed)
    const isValidPassword = await Bun.password.verify(password, targetHash);

    // Now check user existence and validity
    if (!user?.passwordHash || !isValidPassword) {
      // Check if it was an OAuth account (only if user exists, but we return generic error anyway)
      if (user && !user.passwordHash) {
        // Still wait for min time before returning
        await enforceMinExecutionTime(startTime);
        return c.json({ error: "auth.error.accountUsesGoogleSignIn" }, 401);
      }

      // Still wait for min time before returning
      await enforceMinExecutionTime(startTime);
      return c.json({ error: "auth.error.invalidCredentials" }, 401);
    }

    if (!user.emailVerified) {
      await enforceMinExecutionTime(startTime);
      return c.json({ error: "auth.error.emailNotVerified" }, 403);
    }

    setUserSession(c, user, rememberMe);

    // Constant time mitigation: Ensure request takes at least MIN_EXEC_TIME ms
    // This masks the difference between DB lookup times (found vs not found)
    await enforceMinExecutionTime(startTime);

    return c.json({
      success: true,
      message: "auth.success.loggedIn",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        moderatedCountries: user.moderatedCountries,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    // Even on error, try to maintain timing if possible
    await enforceMinExecutionTime(startTime);

    return c.json({ error: "auth.error.loginFailed" }, 500);
  }
});

// Google OAuth login endpoint
authApp.post("/api/google-login", async (c) => {
  try {
    // Rate limit: 20 attempts per IP per minute (slightly higher for OAuth)
    const ip = getClientIp(c);
    if (!rateLimit.check(ip, 20, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    const body = await c.req.json();
    const { token, rememberMe } = await validateGoogleLoginRequest(body);

    // Verify Google token
    const googleUser = await verifyGoogleToken(token);

    if (!googleUser) {
      return c.json({ error: "auth.error.invalidGoogleToken" }, 401);
    }

    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerAccountId: googleUser.googleId,
      email: googleUser.email,
      name: googleUser.name,
      // Only link to / update an existing account when Google says this email is verified
      trustProviderEmail: googleUser.emailVerified,
    });

    setUserSession(c, user, rememberMe);

    return c.json({
      success: true,
      message: "auth.success.googleAuthSuccess",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        moderatedCountries: user.moderatedCountries,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error: any) {
    console.error("Google login error:", error);

    // Handle account conflict error or validation error with explicit status code
    if (error.statusCode) {
      return c.json(
        {
          error: error.message,
          action: error.action,
        },
        error.statusCode, // 400 or 409
      );
    }

    // Handle unexpected errors securely (don't leak raw error message)
    return c.json({ error: "auth.error.googleAuthFailed" }, 500);
  }
});

// OpenStreetMap OAuth: kick off the authorization-code flow by redirecting the
// browser to OSM. CSRF state is stashed in the session for validation on return.
authApp.get("/api/osm-login", (c) => {
  const frontendUrl = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  try {
    const ip = getClientIp(c);
    if (!rateLimit.check(ip, 20, 60 * 1000)) {
      return c.redirect(`${frontendUrl}/?error=too_many_requests`);
    }

    if (!isOsmConfigured()) {
      console.error("OSM OAuth not configured (missing OSM_CLIENT_ID / OSM_CLIENT_SECRET)");
      return c.redirect(`${frontendUrl}/?error=unexpected`);
    }

    const rememberMe = c.req.query("rememberMe") === "true";
    const state = crypto.randomBytes(32).toString("hex");

    const session = c.get("session");
    session.set("osmOauth", { state, rememberMe });

    return c.redirect(buildOsmAuthorizeUrl(state));
  } catch (error) {
    console.error("OSM login initiation error:", error);
    return c.redirect(`${frontendUrl}/?error=unexpected`);
  }
});

// OpenStreetMap OAuth callback: validate state, exchange the code for the user's
// profile, resolve or create the account, then redirect back to the SPA.
authApp.get("/api/osm-callback", async (c) => {
  const frontendUrl = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  const session = c.get("session");
  const osmOauth = session.get("osmOauth");
  session.set("osmOauth", undefined); // single-use, cleared regardless of outcome

  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const denied = c.req.query("error"); // e.g. "access_denied" when the user cancels

    if (denied || !code || !state) {
      return c.redirect(`${frontendUrl}/?error=no_session`);
    }

    if (!osmOauth || osmOauth.state !== state) {
      return c.redirect(`${frontendUrl}/?error=auth_failed`);
    }

    const osmUser = await exchangeOsmCodeForUser(code);
    if (!osmUser) {
      return c.redirect(`${frontendUrl}/?error=auth_failed`);
    }

    // OSM never exposes an email, so synthesize a stable, non-routable one.
    const user = await findOrCreateOAuthUser({
      provider: "osm",
      providerAccountId: osmUser.osmId,
      email: `osm-${osmUser.osmId}@${SYNTHETIC_EMAIL_DOMAIN}`,
      name: osmUser.displayName,
      trustProviderEmail: false,
    });

    setUserSession(c, user, osmOauth.rememberMe);

    return c.redirect(`${frontendUrl}/?auth=success&provider=osm`);
  } catch (error) {
    console.error("OSM callback error:", error);
    return c.redirect(`${frontendUrl}/?error=unexpected`);
  }
});

authApp.post("/api/logout", (c) => {
  try {
    const session = c.get("session");
    session.deleteSession();
    return c.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Logout failed" }, 500);
  }
});

authApp.get("/api/check-session", async (c) => {
  const sessionUser = await resolveSessionUser(c.get("session"));

  let infoMessage: string | null = null;
  try {
    const [dbConfig] = await db.select().from(config).where(eq(config.id, 1)).limit(1);
    infoMessage = dbConfig?.infoMessage ?? null;
  } catch (error) {
    console.error("Error fetching config:", error);
  }

  return c.json({
    userId: sessionUser?.id,
    isAuthenticated: Boolean(sessionUser),
    user: sessionUser,
    infoMessage,
  });
});
