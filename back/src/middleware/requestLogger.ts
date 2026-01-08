import type { Context, Next } from "hono";
import { logger } from "../services/logger";
import { errorAlerter } from "../services/errorAlerter";

// AI : Only alert on errors from routes that the app actually serves
// AI : This is a proper allowlist approach - anything not matching is a bot probe
const ALERTABLE_PATH_PREFIXES = ["/api/", "/trpc/", "/uploads/"];

// AI : Check if a path is from a route we actually serve (and thus worth alerting on)
function shouldAlertOnPath(path: string): boolean {
  return ALERTABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// AI : Extract Cloudflare headers from request
function getCloudflareHeaders(c: Context) {
  return {
    cfConnectingIp: c.req.header("CF-Connecting-IP"),
    cfCountry: c.req.header("CF-IPCountry"),
    cfRay: c.req.header("CF-Ray"),
  };
}

// AI : Extract client IP (prioritize Cloudflare header)
function getClientIp(c: Context): string | undefined {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    c.req.header("X-Real-IP")
  );
}

// AI : Get user ID from session if available
function getUserId(c: Context): number | undefined {
  try {
    // AI : Session is stored in c.get('session') by Hono session middleware
    const session = c.get("session");
    return session?.userId;
  } catch {
    return undefined;
  }
}

// AI : Request logging middleware
export async function requestLogger(c: Context, next: Next) {
  const startTime = Date.now();

  // AI : Extract request details
  const method = c.req.method;
  const path = c.req.path;

  // AI : Skip logging static assets in development (reduce noise)
  // AI : Set LOG_STATIC=true to log them
  const skipStatic = process.env.NODE_ENV === "development" && process.env.LOG_STATIC !== "true";
  if (skipStatic && (path.startsWith("/uploads/") || path.endsWith(".webp"))) {
    await next();
    return;
  }

  const userAgent = c.req.header("User-Agent");
  const ip = getClientIp(c);
  const cloudflare = getCloudflareHeaders(c);

  try {
    // AI : Continue to next middleware/handler
    await next();

    // AI : Calculate duration
    const duration = Date.now() - startTime;
    const status = c.res.status;
    const userId = getUserId(c);

    // AI : Log request
    logger.info({
      method,
      path,
      status,
      duration,
      ip,
      cfCountry: cloudflare.cfCountry,
      cfRay: cloudflare.cfRay,
      userAgent,
      userId,
    });

    // AI : Track errors for alerting (4xx and 5xx), but only for routes we serve
    if (status >= 400 && shouldAlertOnPath(path)) {
      errorAlerter.addError({
        timestamp: Date.now(),
        method,
        path,
        status,
        ip,
      });
    }
  } catch (error) {
    // AI : Log error and re-throw
    const duration = Date.now() - startTime;
    const status = c.res.status ?? 500;

    logger.error({
      method,
      path,
      status,
      duration,
      ip,
      cfCountry: cloudflare.cfCountry,
      cfRay: cloudflare.cfRay,
      userAgent,
      error: error instanceof Error ? error.message : String(error),
    });

    // AI : Track error for alerting, but only for routes we serve
    if (shouldAlertOnPath(path)) {
      errorAlerter.addError({
        timestamp: Date.now(),
        method,
        path,
        status,
        message: error instanceof Error ? error.message : String(error),
        ip,
      });
    }

    throw error;
  }
}
