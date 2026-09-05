import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { sessionMiddleware } from "hono-sessions";
import { secureHeaders } from "hono/secure-headers";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { appRouter } from "./routes";
import { tilesApp, warmLowZoomTileCache } from "./routes/tiles";
import { seoApp } from "./routes/seo";
import { authApp, SESSION_DURATION_LONG } from "./routes/auth";
import { uploadsApp } from "./routes/uploads";
import { isAllowedCorsOrigin } from "./lib/corsConfig";
import type { AppEnv } from "./lib/types";
import { config as appConfig } from "./config";
import { generateMissingThumbnails } from "./lib/startup";
import { sessionStore, startSessionCleanup } from "./lib/drizzleSessionStore";
import { resolveSessionUser } from "./lib/currentUser";
import { requestLogger } from "./middleware/requestLogger";
import { logger } from "./services/logger";
import { startCleanupJob } from "./services/cleanupService";
import { startR2MigrationService } from "./services/r2MigrationService";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;

      if (process.env.NODE_ENV === "development") {
        return origin; // Allow all origins in development
      }

      return isAllowedCorsOrigin(origin) ? origin : null;
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

// Request logging for everything past the health check, including the cookie-free tile and SEO
// routes below. Session state is read only after next(), so downstream session writes are visible.
app.use("*", requestLogger);

// Public tile endpoints - mounted before session middleware (no auth needed)
app.route("/api/tiles", tilesApp);

// Public SEO endpoints (project metadata + sitemap) - cookie-free, mounted before session middleware
app.route("/", seoApp);

app.use(
  "*",
  sessionMiddleware({
    // @ts-ignore hono doesn't like the session store's type for some reason
    store: sessionStore,
    sessionCookieName: "session",
    encryptionKey: appConfig.COOKIE_SECRET,
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

// tRPC routes
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    async createContext(_opts: FetchCreateContextFnOptions, c: Context) {
      return {
        user: await resolveSessionUser(c.get("session")),
        hono: c,
      };
    },
  }),
);

// Cookie-session auth endpoints and image upload/serving (need the session middleware above)
app.route("/", authApp);
app.route("/", uploadsApp);

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

startCleanupJob();
startR2MigrationService();
startSessionCleanup();

export type { AppRouter } from "./routes";

export default {
  port: appConfig.PORT,
  idleTimeout: 60, // because tile generation for low zoom level on server start can be very slow
  fetch: app.fetch,
};
