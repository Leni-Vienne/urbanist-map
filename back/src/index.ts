import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { sessionMiddleware, type Session } from "hono-sessions";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import { secureHeaders } from "hono/secure-headers";
import { appRouter } from "./routes";
import { tilesApp } from "./routes/tiles";
import { LocalFileStorage, getThumbnailFilename, compressImageIfNeeded } from "./lib/storage";
import type { FileUploadResult, FileUploadError } from "./lib/types";
import { config as appConfig } from "./config";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { generateMissingThumbnails } from "./lib/startup";
import { DrizzleSessionStore } from "./lib/drizzleSessionStore";
import { requestLogger } from "./middleware/requestLogger";
import { errorAlerter } from "./services/errorAlerter";
import { globalRateLimiter } from "./lib/rateLimit";
import { getClientIp } from "./utils/ip";
import { logger } from "./services/logger";
import { db } from "./database";
import { users, config, overlays, projects, cities } from "./db/schema";
import { eq } from "drizzle-orm";
import { verifyGoogleToken } from "./utils/googleAuth";
import { startCleanupJob } from "./services/cleanupService";
import { startR2MigrationService } from "./services/r2MigrationService";

type SessionData = {
  user?: {
    id: string;
    email: string;
    username: string | null;
    role: string | null;
    moderatedCountries: string[] | null;
    emailVerified: boolean;
  };
  expiresAt?: string;
};

const app = new Hono<{
  Variables: {
    session: Session<SessionData>;
  };
}>();

// Always use local storage for initial uploads - images migrate to R2 on approval
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

// Secure headers (Helmet equivalent)
// Adds CSP, HSTS, X-Frame-Options, etc.
// Exclude /uploads/* path from secureHeaders to allow cross-origin resource loading
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/uploads/")) {
    // Skip secureHeaders for uploads to allow custom CORS/CORP headers
    return next();
  }
  return secureHeaders()(c, next);
});

// CRITICAL: Health check endpoint MUST be before session middleware
// Caddy polls this every 30 seconds - we don't want to create sessions for health checks!
app.get("/api/health", (c) => {
  const timestamp = new Date().toISOString();

  // Log health check at info level for Grafana heartbeat monitoring
  // Caddy polls every 30s - these logs are used to detect service downtime
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

// Public tile endpoints - mounted before session middleware (no auth needed)
app.route("/api/tiles", tilesApp);

// Session duration constants
const SESSION_DURATION_SHORT = 7 * 24 * 60 * 60; // 7 days for regular login
const SESSION_DURATION_LONG = 30 * 24 * 60 * 60; // 30 days for "Remember Me"

const store = new DrizzleSessionStore();

app.use(
  "*",
  sessionMiddleware({
    // @ts-ignore hono doesn't like DrizzleSessionStore's type for some reason
    store,
    sessionCookieName: "session",
    encryptionKey: process.env.COOKIE_SECRET ?? "fallback-secret-key-for-dev-at-least-32-chars",
    expireAfterSeconds: SESSION_DURATION_LONG, // Max duration, actual duration set per login
    cookieOptions: {
      httpOnly: true,
      // secure must be true when sameSite is 'None' for cross-site cookies
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      // No domain restriction to allow the cookie to work with the backend domain
      path: "/",
    },
  }),
);

// Request logging middleware (after session middleware)
app.use("*", requestLogger);

// tRPC routes
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

// Auth routes using Hono (for session management)
app.post("/api/login", async (c) => {
  // Measure start time to enforce constant time response
  const startTime = Date.now();

  try {
    // Rate limit: 10 attempts per IP per minute
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 10, 60 * 1000)) {
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

    // Check if email is verified
    if (!user.emailVerified) {
      // Still wait for min time before returning
      await enforceMinExecutionTime(startTime);
      return c.json({ error: "auth.error.emailNotVerified" }, 403);
    }

    // Set session with full user data
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

// Helper function to validate Google login request
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

// Helper function to update existing user's email if changed on Google's side
async function updateExistingUserEmail(existingUser: any, newEmail: string) {
  if (existingUser.email !== newEmail) {
    try {
      await db
        .update(users)
        .set({
          email: newEmail,
          emailVerified: true,
          emailVerificationToken: null,
        })
        .where(eq(users.id, existingUser.id));

      // Refetch updated user
      const [updatedUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, existingUser.id))
        .limit(1);
      return updatedUser;
    } catch (error: any) {
      // Check for unique constraint violation (email taken)
      if (
        error.code === "23505" ||
        error.message?.includes("unique constraint") ||
        error.message?.includes("duplicate key")
      ) {
        throw Object.assign(new Error("auth.error.emailTaken"), {
          statusCode: 409, // Conflict
          action: "account_conflict",
        });
      }
      throw error;
    }
  }
  return existingUser;
}

// Helper function to link Google account to existing password-based account
async function linkGoogleToPasswordAccount(emailUser: any, googleId: string) {
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

// Helper function to create new Google OAuth user.
// Uses insert-and-retry on username unique constraint violation to avoid
// the TOCTOU race condition of the previous check-then-insert approach.
async function createGoogleUser(googleUser: { email: string; name: string; googleId: string }) {
  const baseUsername = googleUser.name;
  let username = baseUsername;
  let counter = 1;

  // eslint-disable-next-line no-unnecessary-condition
  while (true) {
    try {
      const [newUser] = await db
        .insert(users)
        .values({
          email: googleUser.email,
          username,
          emailVerified: true,
          passwordHash: null,
          googleId: googleUser.googleId,
        })
        .returning();
      return newUser;
    } catch (error: any) {
      // Retry only on username uniqueness conflict (constraint name from Drizzle: users_username_unique)
      if (error.code === "23505" && error.constraint === "users_username_unique") {
        username = `${baseUsername}${counter}`;
        counter += 1;
      } else {
        throw error;
      }
    }
  }
}

// Helper function to find or create user from Google authentication
async function findOrCreateGoogleUser(googleUser: {
  email: string;
  name: string;
  googleId: string;
}) {
  // SECURE: First check by googleId (not email!)
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.googleId, googleUser.googleId))
    .limit(1);

  if (existingUser) {
    // User found by Google ID - update email if changed on Google's side
    return updateExistingUserEmail(existingUser, googleUser.email);
  }

  // No user found by Google ID - check if email exists with different auth method
  const [emailUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, googleUser.email))
    .limit(1);

  if (emailUser) {
    if (emailUser.googleId) {
      // SECURITY: Email already linked to a different Google account
      throw Object.assign(new Error("auth.error.emailLinkedToDifferentGoogle"), {
        statusCode: 409,
        action: "account_conflict",
      });
    }

    // SECURE AUTO-LINKING: Link Google account to existing password account
    return linkGoogleToPasswordAccount(emailUser, googleUser.googleId);
  }

  // Create new Google OAuth user
  return createGoogleUser(googleUser);
}

// Helper function to set user session
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

// Google OAuth login endpoint
app.post("/api/google-login", async (c) => {
  try {
    // Rate limit: 20 attempts per IP per minute (slightly higher for OAuth)
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 20, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" }, 429);
    }

    const body = await c.req.json();
    const { token, rememberMe } = await validateGoogleLoginRequest(body);

    // Verify Google token
    const googleUser = await verifyGoogleToken(token);

    if (!googleUser) {
      return c.json({ error: "auth.error.invalidGoogleToken" }, 401);
    }

    // Find existing user or create new one
    const user = await findOrCreateGoogleUser(googleUser);

    // Set session
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

    // Fetch config for info message (if exists)
    const [dbConfig] = await db.select().from(config).where(eq(config.id, 1)).limit(1);

    return c.json({
      userId: sessionUser?.id,
      isAuthenticated: Boolean(sessionUser),
      user: sessionUser ?? null,
      infoMessage: dbConfig?.infoMessage ?? null,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    // Return session info even if config fetch fails
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

// File upload endpoint
app.post("/api/upload-image", async (c) => {
  try {
    // Rate limit: 10 uploads per IP per minute
    const ip = getClientIp(c);
    if (!globalRateLimiter.check(ip, 10, 60 * 1000)) {
      return c.json({ error: "auth.error.tooManyRequests" } as FileUploadError, 429);
    }

    // Require authentication
    // Uploads are only allowed for logged-in users to prevent anonymous spam
    const session = c.get("session");
    const user = session.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" } as FileUploadError, 401);
    }

    const body = await c.req.formData();
    const file = body.get("image");

    if (!(file instanceof File)) {
      logger.warn({ fileType: typeof file }, "Upload failed: No file provided");
      return c.json({ error: "No file provided" } as FileUploadError, 400);
    }

    // Validate file with Zod
    const validationResult = imageFileSchema.safeParse({
      size: file.size,
      type: file.type,
      name: file.name,
    });

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      logger.warn(
        { fileName: file.name, fileType: file.type, fileSize: file.size, errors: errorMessage },
        "Upload failed: Zod validation error",
      );
      return c.json({ error: errorMessage } as FileUploadError, 400);
    }

    // Extract file extension for filename generation
    const lastDot = file.name.lastIndexOf(".");
    const fileExtension =
      lastDot !== -1 && lastDot !== file.name.length - 1
        ? file.name.slice(lastDot + 1).toLowerCase()
        : null;

    // Ensure we have a valid extension (this should not fail due to Zod validation)
    if (!fileExtension) {
      logger.warn({ fileName: file.name }, "Upload failed: Invalid file extension");
      return c.json({ error: "Invalid file extension" } as FileUploadError, 400);
    }

    const originalBuffer = await file.arrayBuffer();

    // Smart compression: convert to WebP at quality 90, but keep original if it's smaller
    // This prevents double-compression artifacts on already-optimized images
    const compressionResult = await compressImageIfNeeded(originalBuffer, fileExtension);

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).slice(2, 15);
    const filename = `${timestamp}-${randomString}.${compressionResult.extension}`;

    // Log compression results for monitoring (structured logging for Grafana)
    const savings = compressionResult.originalSize - compressionResult.finalSize;
    const savingsPercent =
      compressionResult.originalSize > 0
        ? ((savings / compressionResult.originalSize) * 100).toFixed(1)
        : "0";

    logger.info(
      {
        event: "image_compression",
        originalName: file.name,
        originalFormat: fileExtension,
        finalFormat: compressionResult.extension,
        originalSize: compressionResult.originalSize,
        finalSize: compressionResult.finalSize,
        savedBytes: savings,
        savingsPercent: Number.parseFloat(savingsPercent),
        wasCompressed: compressionResult.wasCompressed,
      },
      compressionResult.wasCompressed
        ? `Image compressed: ${file.name} (${fileExtension}) → WebP, saved ${(savings / 1024).toFixed(1)}KB (${savingsPercent}%)`
        : `Image kept original: ${file.name} (${compressionResult.extension}), compressed version was not smaller`,
    );

    // Save to local storage - images are not uploaded to R2 until moderator approval
    // LocalFileStorage.put also automatically generates 120x120 thumbnail
    await storage.put(filename, compressionResult.buffer);

    // Always return local URL - images stay in local storage until approved
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

// Serve uploaded files with authorization
// Pending images are only accessible to: author, country moderators, and admins
// Approved images are public (legacy support for approved images still in local storage)
app.get("/uploads/*", async (c) => {
  try {
    const filename = c.req.path.replace("/uploads/", "");

    // Validate filename parameter with Zod
    const validationResult = filenameParamSchema.safeParse({ filename });
    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((err) => err.message).join(", ");
      return c.json({ error: errorMessage }, 400);
    }

    const validatedFilename = validationResult.data.filename;

    // Extract actual filename (strip thumbnails/ prefix if present)
    const actualFilename = validatedFilename.startsWith("thumbnails/")
      ? validatedFilename.replace("thumbnails/", "")
      : validatedFilename;

    // Query overlay info for authorization check
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

    // If overlay doesn't exist in DB, file not found
    if (overlayInfo.length === 0) {
      return c.json({ error: "File not found" }, 404);
    }

    const overlay = overlayInfo[0];

    if (!overlay) {
      return c.json({ error: "File not found" }, 404);
    }

    // Authorization logic
    // Approved images are public (legacy support)
    if (overlay.status === "approved") {
      // Allow access - approved images are public
    } else {
      // Pending/rejected images require authentication
      const session = c.get("session");
      const user = session.get("user");

      if (!user) {
        return c.json({ error: "Authentication required" }, 401);
      }

      // Check authorization for pending/rejected images
      const isAuthor = user.id === overlay.authorId;
      const isAdmin = user.role === "admin" || user.moderatedCountries === null;
      const isCountryModerator = user.moderatedCountries?.includes(overlay.countryCode);

      if (!isAuthor && !isAdmin && !isCountryModerator) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    // User is authorized, serve the file
    const file = await storage.get(validatedFilename);

    if (file) {
      // Get origin from request for CORS (must match exact origin to allow credentials)
      const origin = c.req.header("Origin");
      const allowedOrigin = origin ?? "*"; // Fallback to * if no origin header

      return new Response(file.body, {
        headers: {
          "Content-Type": file.contentType ?? "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, must-revalidate",
          ETag: `"${filename}-${Date.now()}"`,
          // CRITICAL: Must use specific origin (not *) to allow credentials (session cookies)
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          // Allow cross-origin resource loading (overrides secureHeaders middleware)
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

// Only serve frontend files in development mode
if (process.env.NODE_ENV === "development") {
  // Static file serving for frontend
  app.use("*", serveStatic({ root: "./front/dist" }));

  // SPA fallback - serve index.html for client-side routing
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

// Helper function to enforce minimum execution time to mitigate timing attacks
async function enforceMinExecutionTime(startTime: number) {
  const MIN_EXEC_TIME = 200; // 200ms target duration
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_EXEC_TIME) {
    await Bun.sleep(MIN_EXEC_TIME - elapsed);
  }
}

// Zod validation schemas
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

// Generate missing thumbnails on startup
// This runs asynchronously and doesn't block server startup
generateMissingThumbnails().catch((error) => {
  console.error("Failed to generate missing thumbnails:", error);
});

// Start error alerting service
errorAlerter.start();
startCleanupJob();
startR2MigrationService();

export type { AppRouter } from "./routes";

export default {
  port: appConfig.PORT,
  // Hostname: '0.0.0.0', //useful for testing on another device in dev, but breaks healthcheck in prod
  fetch: app.fetch,
};
