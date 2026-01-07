import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { sessionMiddleware, type Session } from "hono-sessions";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import { secureHeaders } from "hono/secure-headers";
import { appRouter } from "./routes";
import { LocalFileStorage, getThumbnailFilename } from "./lib/storage";
import type { FileUploadResult, FileUploadError } from "./lib/types";
import { config } from "./config";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { generateMissingThumbnails } from "./lib/startup";
import { DrizzleSessionStore } from "./lib/drizzleSessionStore";
import { requestLogger } from "./middleware/requestLogger";
import { errorAlerter } from "./services/errorAlerter";
import { globalRateLimiter } from "./lib/rateLimit";
import { getClientIp } from "./utils/ip";
import { logger } from "./services/logger";

// AI : Session data type
type SessionData = {
  user?: {
    id: string;
    email: string;
    username: string | null;
    role: string | null;
    moderatedCountries: string[] | null; // AI : Array of country codes for moderators
    emailVerified: boolean;
  };
  expiresAt?: string;
};

// AI : Main application setup
const app = new Hono<{
  Variables: {
    session: Session<SessionData>;
  };
}>();

// AI : Always use local storage for initial uploads - images migrate to R2 on approval
const storage = new LocalFileStorage();

const allowedDomains = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;

      if (process.env.NODE_ENV !== "production") {
        return origin; // Allow all origins in development
      }

      // Allow if matches any root domain or subdomain, usefull for checking older cloudflare deployments
      const isAllowed = allowedDomains.some(
        (domain) => origin === `https://${domain}` || origin.endsWith(`.${domain}`),
      );

      return isAllowed ? origin : null;
    },
    credentials: true,
  }),
);

// AI : Secure headers (Helmet equivalent)
// AI : Adds CSP, HSTS, X-Frame-Options, etc.
// AI : Exclude /uploads/* path from secureHeaders to allow cross-origin resource loading
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/uploads/")) {
    // AI : Skip secureHeaders for uploads to allow custom CORS/CORP headers
    return next();
  }
  return secureHeaders()(c, next);
});

// AI : CRITICAL: Health check endpoint MUST be before session middleware
// AI : Caddy polls this every 30 seconds - we don't want to create sessions for health checks!
app.get("/api/health", (c) => {
  const timestamp = new Date().toISOString();

  // AI : Log health check at info level for Grafana heartbeat monitoring
  // AI : Caddy polls every 30s - these logs are used to detect service downtime
  logger.info(
    {
      method: "GET",
      path: "/api/health",
      status: 200,
      timestamp,
    },
    "Health check",
  );

  return c.json({ status: "ok", timestamp });
});

// AI : Database-backed session store using Drizzle ORM for persistence across server restarts
const store = new DrizzleSessionStore();

// AI : Session duration constants
const SESSION_DURATION_SHORT = 7 * 24 * 60 * 60; // AI : 7 days for regular login
const SESSION_DURATION_LONG = 30 * 24 * 60 * 60; // AI : 30 days for "Remember Me"

app.use(
  "*",
  sessionMiddleware({
    store,
    sessionCookieName: "session",
    encryptionKey: process.env.JWT_SECRET ?? "fallback-secret-key-for-dev-at-least-32-chars",
    expireAfterSeconds: SESSION_DURATION_LONG, // AI : Max duration, actual duration set per login
    cookieOptions: {
      httpOnly: true,
      // AI : secure must be true when sameSite is 'None' for cross-site cookies
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      // AI : No domain restriction to allow the cookie to work with the backend domain
      path: "/",
    },
  }),
);

// AI : Request logging middleware (after session middleware)
app.use("*", requestLogger);

// AI : tRPC routes
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext(_opts: FetchCreateContextFnOptions, c: Context) {
      const session = c.get("session");
      return {
        user: session.get("user") ?? null,
        session,
        hono: c,
      };
    },
  }),
);

// AI : Helper function to enforce minimum execution time
async function enforceMinExecutionTime(startTime: number) {
  const MIN_EXEC_TIME = 200; // 200ms target duration
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_EXEC_TIME) {
    await Bun.sleep(MIN_EXEC_TIME - elapsed);
  }
}

// AI : Auth routes using Hono (for session management)
app.post("/api/login", async (c) => {
  // AI : Measure start time to enforce constant time response
  const startTime = Date.now();

  try {
    // AI : Rate limit: 10 attempts per IP per minute
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 10, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    const body = await c.req.json();

    // AI : Validate request body with Zod
    const validationResult = loginSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage }, 400);
    }

    const { email, password, rememberMe } = validationResult.data;

    // AI : Find user (same logic as tRPC route)
    const { db } = await import("./database");
    const { users } = await import("./db/schema");
    const { eq } = await import("drizzle-orm");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // AI : SECURITY: Mitigate timing attack
    // Always perform password verification even if user doesn't exist
    // This ensures consistent response time (~80ms) for both valid and invalid emails
    const dummyHash =
      "$argon2id$v=19$m=65536,t=2,p=1$WzgfyslW80m4IOmzoEo0MiRnRnyqnFVzaFLp/S1kQIQ$RO1WV3KLiIMekWVluRf8a2oDncmEoVmUPD9MCN1wMd4";
    const targetHash = user?.passwordHash ?? dummyHash;

    // AI : Verify password (always executed)
    const isValidPassword = await Bun.password.verify(password, targetHash);

    // AI : Now check user existence and validity
    if (!user?.passwordHash || !isValidPassword) {
      // AI : Check if it was an OAuth account (only if user exists, but we return generic error anyway)
      if (user && !user.passwordHash) {
        // AI : Still wait for min time before returning
        await enforceMinExecutionTime(startTime);
        return c.json({ error: "auth.error.accountUsesGoogleSignIn" }, 401);
      }

      // AI : Still wait for min time before returning
      await enforceMinExecutionTime(startTime);
      return c.json({ error: "auth.error.invalidCredentials" }, 401);
    }

    // AI : Check if email is verified
    if (!user.emailVerified) {
      // AI : Still wait for min time before returning
      await enforceMinExecutionTime(startTime);
      return c.json({ error: "auth.error.emailNotVerified" }, 403);
    }

    // AI : Set session with full user data
    setUserSession(c, user, rememberMe);

    // AI : Constant time mitigation: Ensure request takes at least MIN_EXEC_TIME ms
    // AI : This masks the difference between DB lookup times (found vs not found)
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

    // AI : Even on error, try to maintain timing if possible
    await enforceMinExecutionTime(startTime);

    return c.json({ error: "auth.error.loginFailed" }, 500);
  }
});

// AI : Helper function to validate Google login request
async function validateGoogleLoginRequest(body: unknown) {
  const googleLoginSchema = z.object({
    token: z.string().min(1, "Google token is required"),
    rememberMe: z.boolean().optional().default(false),
  });

  const validationResult = googleLoginSchema.safeParse(body);
  if (!validationResult.success) {
    const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
    throw new Error(errorMessage);
  }

  return validationResult.data;
}

// AI : Helper function to update existing user's email if changed on Google's side
async function updateExistingUserEmail(existingUser: any, newEmail: string) {
  const { db } = await import("./database");
  const { users } = await import("./db/schema");
  const { eq } = await import("drizzle-orm");

  if (existingUser.email !== newEmail) {
    await db
      .update(users)
      .set({
        email: newEmail,
        emailVerified: true,
        emailVerificationToken: null,
      })
      .where(eq(users.id, existingUser.id));

    // AI : Refetch updated user
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingUser.id))
      .limit(1);
    return updatedUser;
  }

  return existingUser;
}

// AI : Helper function to link Google account to existing password-based account
async function linkGoogleToPasswordAccount(emailUser: any, googleId: string) {
  const { db } = await import("./database");
  const { users } = await import("./db/schema");
  const { eq } = await import("drizzle-orm");

  await db
    .update(users)
    .set({
      googleId,
      emailVerified: true,
      emailVerificationToken: null,
    })
    .where(eq(users.id, emailUser.id));

  return {
    ...emailUser,
    googleId,
    emailVerified: true,
  };
}

// AI : Helper function to generate unique username
async function generateUniqueUsername(baseUsername: string) {
  const { db } = await import("./database");
  const { users } = await import("./db/schema");
  const { eq } = await import("drizzle-orm");

  let finalUsername = baseUsername;
  let counter = 1;

  while (true) {
    const existingUsername = await db
      .select()
      .from(users)
      .where(eq(users.username, finalUsername))
      .limit(1);
    if (existingUsername.length === 0) break;
    finalUsername = `${baseUsername}${counter}`;
    counter += 1;
  }

  return finalUsername;
}

// AI : Helper function to create new Google OAuth user
async function createGoogleUser(googleUser: { email: string; name: string; googleId: string }) {
  const { db } = await import("./database");
  const { users } = await import("./db/schema");

  const finalUsername = await generateUniqueUsername(googleUser.name);

  const [newUser] = await db
    .insert(users)
    .values({
      email: googleUser.email,
      username: finalUsername,
      emailVerified: true,
      passwordHash: null,
      googleId: googleUser.googleId,
    })
    .returning();

  return newUser;
}

// AI : Helper function to find or create user from Google authentication
async function findOrCreateGoogleUser(googleUser: {
  email: string;
  name: string;
  googleId: string;
}) {
  const { db } = await import("./database");
  const { users } = await import("./db/schema");
  const { eq } = await import("drizzle-orm");

  // AI : SECURE: First check by googleId (not email!)
  let [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.googleId, googleUser.googleId))
    .limit(1);

  if (existingUser) {
    // AI : User found by Google ID - update email if changed on Google's side
    return await updateExistingUserEmail(existingUser, googleUser.email);
  }

  // AI : No user found by Google ID - check if email exists with different auth method
  const [emailUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, googleUser.email))
    .limit(1);

  if (emailUser) {
    if (emailUser.googleId) {
      // AI : SECURITY: Email already linked to a different Google account
      throw Object.assign(new Error("auth.error.emailLinkedToDifferentGoogle"), {
        statusCode: 409,
        action: "account_conflict",
      });
    }

    // AI : SECURE AUTO-LINKING: Link Google account to existing password account
    return await linkGoogleToPasswordAccount(emailUser, googleUser.googleId);
  }

  // AI : Create new Google OAuth user
  return await createGoogleUser(googleUser);
}

// AI : Helper function to set user session
function setUserSession(c: Context, user: any, rememberMe: boolean) {
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

// AI : Google OAuth login endpoint
app.post("/api/google-login", async (c) => {
  try {
    // AI : Rate limit: 20 attempts per IP per minute (slightly higher for OAuth)
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 20, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    const body = await c.req.json();
    const { token, rememberMe } = await validateGoogleLoginRequest(body);

    // AI : Verify Google token
    const { verifyGoogleToken } = await import("./utils/googleAuth");
    const googleUser = await verifyGoogleToken(token);

    if (!googleUser) {
      return c.json({ error: "auth.error.invalidGoogleToken" }, 401);
    }

    // AI : Find existing user or create new one
    const user = await findOrCreateGoogleUser(googleUser);

    // AI : Set session
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

    // AI : Handle account conflict error
    if (error.statusCode === 409) {
      return c.json(
        {
          error: error.message,
          action: error.action,
        },
        409,
      );
    }

    // AI : Handle validation errors
    if (error.message && !error.statusCode) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "auth.error.googleAuthFailed" }, 500);
  }
});

app.post("/api/logout", (c) => {
  try {
    const session = c.get("session");
    session.deleteSession();
    return c.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Logout failed" }, 500);
  }
});

app.get("/api/check-session", async (c) => {
  try {
    const session = c.get("session");
    const sessionUser = session.get("user");

    // AI : Fetch config for info message (if exists)
    const { db } = await import("./database");
    const { config } = await import("./db/schema");
    const { eq } = await import("drizzle-orm");

    const [appConfig] = await db.select().from(config).where(eq(config.id, 1)).limit(1);

    return c.json({
      userId: sessionUser?.id,
      isAuthenticated: Boolean(sessionUser),
      user: sessionUser ?? null,
      infoMessage: appConfig?.infoMessage ?? null,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    // AI : Return session info even if config fetch fails
    const session = c.get("session");
    const sessionUser = session.get("user");
    return c.json({
      userId: sessionUser?.id,
      isAuthenticated: Boolean(sessionUser),
      user: sessionUser ?? null,
      infoMessage: null,
    });
  }
});

// AI : File upload endpoint
app.post("/api/upload-image", async (c) => {
  try {
    // AI : Rate limit: 10 uploads per IP per minute
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 10, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" } as FileUploadError, 429);
    }

    // AI : Require authentication
    // AI : Uploads are only allowed for logged-in users to prevent anonymous spam
    const session = c.get("session");
    const user = session.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" } as FileUploadError, 401);
    }

    const body = await c.req.formData();
    const file = body.get("image");

    if (!(file instanceof File)) {
      return c.json({ error: "No file provided" } as FileUploadError, 400);
    }

    // AI : Validate file with Zod
    const validationResult = imageFileSchema.safeParse({
      size: file.size,
      type: file.type,
      name: file.name,
    });

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage } as FileUploadError, 400);
    }

    // AI : Extract file extension for filename generation
    const lastDot = file.name.lastIndexOf(".");
    const fileExtension =
      lastDot !== -1 && lastDot !== file.name.length - 1
        ? file.name.slice(lastDot + 1).toLowerCase()
        : null;

    // AI : Ensure we have a valid extension (this should not fail due to Zod validation)
    if (!fileExtension) {
      return c.json({ error: "Invalid file extension" } as FileUploadError, 400);
    }

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const filename = `${timestamp}-${randomString}.${fileExtension}`;

    const buffer = await file.arrayBuffer();
    // AI : Save to local storage - images are not uploaded to R2 until moderator approval
    // AI : LocalFileStorage.put also automatically generates 120x120 thumbnail
    await storage.put(filename, buffer);

    // AI : Always return local URL - images stay in local storage until approved
    const imageUrl = `/uploads/${filename}`;
    const thumbnailUrl = `/uploads/${getThumbnailFilename(filename)}`;

    return c.json({
      success: true,
      filename: filename,
      url: imageUrl,
      thumbnailUrl: thumbnailUrl,
    } as FileUploadResult);
  } catch (error) {
    console.error("Error uploading file:", error);
    return c.json({ error: "Failed to upload file" } as FileUploadError, 500);
  }
});

// AI : Serve uploaded files with authorization
// AI : Pending images are only accessible to: author, country moderators, and admins
// AI : Approved images are public (legacy support for approved images still in local storage)
app.get("/uploads/*", async (c) => {
  try {
    const filename = c.req.path.replace("/uploads/", "");

    // AI : Validate filename parameter with Zod
    const validationResult = filenameParamSchema.safeParse({ filename });
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage }, 400);
    }

    const validatedFilename = validationResult.data.filename;

    // AI : Extract actual filename (strip thumbnails/ prefix if present)
    const actualFilename = validatedFilename.startsWith("thumbnails/")
      ? validatedFilename.replace("thumbnails/", "")
      : validatedFilename;

    // AI : Query overlay info for authorization check
    const { db } = await import("./database");
    const { overlays, projects, cities } = await import("./db/schema");
    const { eq } = await import("drizzle-orm");

    const overlayInfo = await db
      .select({
        authorId: overlays.authorId,
        status: overlays.status,
        countryCode: cities.countryCode,
      })
      .from(overlays)
      .innerJoin(projects, eq(overlays.projectId, projects.id))
      .innerJoin(cities, eq(projects.cityId, cities.id))
      .where(eq(overlays.filename, actualFilename))
      .limit(1);

    // AI : If overlay doesn't exist in DB, file not found
    if (overlayInfo.length === 0) {
      return c.json({ error: "File not found" }, 404);
    }

    const overlay = overlayInfo[0];

    // AI : Authorization logic
    // AI : Approved images are public (legacy support)
    if (overlay.status === "approved") {
      // AI : Allow access - approved images are public
    } else {
      // AI : Pending/rejected images require authentication
      const session = c.get("session");
      const user = session.get("user");

      if (!user) {
        return c.json({ error: "Authentication required" }, 401);
      }

      // AI : Check authorization for pending/rejected images
      const isAuthor = user.id === overlay.authorId;
      const isAdmin = user.role === "admin" || user.moderatedCountries === null;
      const isCountryModerator = user.moderatedCountries?.includes(overlay.countryCode);

      if (!isAuthor && !isAdmin && !isCountryModerator) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    // AI : User is authorized, serve the file
    const file = await storage.get(validatedFilename);

    if (file) {
      // AI : Get origin from request for CORS (must match exact origin to allow credentials)
      const origin = c.req.header("Origin");
      const allowedOrigin = origin ?? "*"; // Fallback to * if no origin header

      return new Response(file.body, {
        headers: {
          "Content-Type": file.contentType ?? "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, must-revalidate",
          ETag: `"${filename}-${Date.now()}"`,
          // AI : CRITICAL: Must use specific origin (not *) to allow credentials (session cookies)
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          // AI : Allow cross-origin resource loading (overrides secureHeaders middleware)
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    return c.json({ error: "File not found" }, 404);
  } catch (error) {
    console.error("Error serving file:", error);
    return c.json({ error: "Failed to serve file" }, 500);
  }
});

// AI : Only serve frontend files in development mode
if (process.env.NODE_ENV === "development") {
  // AI : Static file serving for frontend
  app.use("*", serveStatic({ root: "./front/dist" }));

  // AI : SPA fallback - serve index.html for client-side routing
  app.notFound(async (c) => {
    try {
      const indexFile = Bun.file("./front/dist/index.html");
      const content = await indexFile.text();
      return c.html(content);
    } catch (error) {
      console.error("Error loading index.html:", error);
      return c.html("<h1>404 Not Found</h1>", 404);
    }
  });
}

// AI : Zod validation schemas
const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

const filenameParamSchema = z.object({
  filename: z
    .string()
    .min(1, "Filename is required")
    .regex(/^[a-zA-Z0-9\-_./]+$/, "Invalid filename format")
    .refine((name) => !name.includes(".."), "Path traversal not allowed"),
});

const imageFileSchema = z.object({
  size: z.number().max(10 * 1024 * 1024, "File too large. Maximum size is 10MB"),
  type: z.enum(["image/jpeg", "image/png", "image/webp"], {
    message: "Invalid file type. Only JPEG, PNG, and WebP are allowed",
  }),
  name: z.string().optional(),
});

// AI : Generate missing thumbnails on startup
// This runs asynchronously and doesn't block server startup
generateMissingThumbnails().catch((error) => {
  console.error("Failed to generate missing thumbnails:", error);
});

import { startCleanupJob } from "./services/cleanupService";
import { startR2MigrationService } from "./services/r2MigrationService";

// AI : Start error alerting service
errorAlerter.start();
startCleanupJob();
startR2MigrationService();

export type { AppRouter } from "./routes";

export default {
  port: config.PORT,
  // Hostname: '0.0.0.0', //useful for testing on another device in dev, but breaks healthcheck in prod
  fetch: app.fetch,
};
