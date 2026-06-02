import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { sessionMiddleware, type Session } from "hono-sessions";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod'
import { secureHeaders } from "hono/secure-headers";
import { appRouter } from "./routes";
import { tilesApp, warmLowZoomTileCache } from "./routes/tiles";
import { LocalFileStorage, getThumbnailFilename, compressImageIfNeeded } from "./lib/storage";
import { exceedsPendingStorageQuota } from "./lib/storageQuota";
import type { FileUploadResult, FileUploadError } from "./lib/types";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { config as appConfig } from "./config";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { generateMissingThumbnails } from "./lib/startup";
import { sessionStore, startSessionCleanup } from "./lib/drizzleSessionStore";
import { requestLogger } from "./middleware/requestLogger";
import { startErrorAlerter } from "./services/errorAlerter";
import * as rateLimit from "./lib/rateLimit";
import { getClientIp } from "./utils/ip";
import { logger } from "./services/logger";
import { db } from "./database";
import { users, config, overlays, projects } from "./db/schema";
import { eq } from "drizzle-orm";
import { verifyGoogleToken } from "./utils/googleAuth";
import { findOrCreateOAuthUser } from "./utils/oauthAccounts";
import { buildOsmAuthorizeUrl, exchangeOsmCodeForUser, isOsmConfigured } from "./utils/osmAuth";
import { SYNTHETIC_EMAIL_DOMAIN } from "@shared/types";
import crypto from "node:crypto";
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
  // Transient CSRF state for the OSM OAuth redirect, set on /api/osm-login and
  // consumed (single-use) on /api/osm-callback.
  osmOauth?: { state: string; rememberMe: boolean };
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

      if (process.env.NODE_ENV === "development") {
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

app.use(
  "*",
  sessionMiddleware({
    // @ts-ignore hono doesn't like the session store's type for some reason
    store: sessionStore,
    sessionCookieName: "session",
    encryptionKey: process.env.COOKIE_SECRET ?? "fallback-secret-key-for-dev-at-least-32-chars",
    expireAfterSeconds: SESSION_DURATION_LONG, // Max duration, actual duration set per login
    cookieOptions: {
      httpOnly: true,
      // secure must be true when sameSite is 'None' for cross-site cookies
      secure: process.env.NODE_ENV !== "development",
      sameSite: process.env.NODE_ENV !== "development" ? "None" : "Lax",
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
app.get("/api/osm-login", (c) => {
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
app.get("/api/osm-callback", async (c) => {
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
    if (!rateLimit.check(ip, 10, 60 * 1000)) {
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

    // Both the compressed file and the uncapped original land in local storage until moderation,
    // so weigh both against the user's pending quota before writing anything to disk.
    const incomingBytes = compressionResult.finalSize + originalBuffer.byteLength;
    if (await exceedsPendingStorageQuota(user.id, incomingBytes)) {
      return c.json({ error: "upload.error.storageQuotaExceeded" } as FileUploadError, 413);
    }

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

    // Keep the pre-compression original locally (never migrated to R2) so approved
    // content retains a full-quality, uncapped source. Removed on rejection/deletion.
    const originalFilename = `${timestamp}-${randomString}.${fileExtension}`;
    try {
      await storage.putOriginal(originalFilename, originalBuffer);
    } catch (error) {
      console.error("Failed to store original image:", error);
    }

    // Always return local URL - images stay in local storage until approved
    const imageUrl = `/uploads/${filename}`;
    const thumbnailUrl = `/uploads/${getThumbnailFilename(filename)}`;

    return c.json({
      success: true,
      filename,
      url: imageUrl,
      thumbnailUrl,
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
        countryCode: projects.countryCode,
      })
      .from(overlays)
      .innerJoin(projects, eq(overlays.projectId, projects.id))
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
      const isAdmin = user.role === "admin";
      const isCountryModerator =
        overlay.countryCode && user.moderatedCountries?.includes(overlay.countryCode);

      if (!isAuthor && !isAdmin && !isCountryModerator) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }

    // User is authorized, serve the file
    const file = await storage.get(validatedFilename);

    if (file) {
      const origin = c.req.header("Origin");
      const isAllowedOrigin =
        origin &&
        allowedDomains.some(
          (domain) => origin === `https://${domain}` || origin.endsWith(`.${domain}`),
        );

      const corsHeaders: Record<string, string> = {
        "Content-Type": file.contentType ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, must-revalidate",
        ETag: `"${filename}-${Date.now()}"`,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cross-Origin-Resource-Policy": "cross-origin",
      };

      if (process.env.NODE_ENV !== "development" && isAllowedOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = origin;
        corsHeaders["Access-Control-Allow-Credentials"] = "true";
      } else if (process.env.NODE_ENV !== "development") {
        corsHeaders["Access-Control-Allow-Origin"] = allowedDomains[0]
          ? `https://${allowedDomains[0]}`
          : "";
      } else {
        // Development: allow any origin
        corsHeaders["Access-Control-Allow-Origin"] = origin ?? "*";
        corsHeaders["Access-Control-Allow-Credentials"] = "true";
      }

      return new Response(file.body, { headers: corsHeaders });
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
  size: z
    .number()
    .max(
      MAX_UPLOAD_FILE_SIZE_BYTES,
      `File too large. Maximum size is ${MAX_UPLOAD_FILE_SIZE_MB}MB`,
    ),
  type: z.enum(["image/jpeg", "image/png", "image/webp"], {
    message: "Invalid file type. Only JPEG, PNG, and WebP are allowed",
  }),
  name: z.string().optional(),
});

// Generate missing thumbnails on startup
// This runs asynchronously and doesn't block server startup
generateMissingThumbnails().catch((error: unknown) => {
  console.error("Failed to generate missing thumbnails:", error);
});

// Pre-warm the z0-z6 tile cache so zoom-out/pan from afar is always a memory hit.
// Runs on any deployed env (preview + production). Skipped in local dev by default (hot reloads
// would re-run it on every reload); enable with WARM_TILE_CACHE=true to test locally.
if (process.env.NODE_ENV !== "development" || process.env.WARM_TILE_CACHE === "true") {
  warmLowZoomTileCache().catch((error: unknown) => {
    console.error("Failed to warm low-zoom tile cache:", error);
  });
}

// Start error alerting service
startErrorAlerter();
startCleanupJob();
startR2MigrationService();
startSessionCleanup();

export type { AppRouter } from "./routes";

export default {
  port: appConfig.PORT,
  idleTimeout: 60, // because tile generation for low zoom level on server start can be very slow
  fetch: app.fetch,
};
