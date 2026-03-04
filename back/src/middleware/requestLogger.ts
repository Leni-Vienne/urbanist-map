import type { Context, Next } from "hono";
import { logger } from "../services/logger";
import { errorAlerter } from "../services/errorAlerter";
import { getClientIp } from "../utils/ip";

// Only alert on errors from routes that the app actually serves
// This is a proper allowlist approach - anything not matching is a bot probe
const ALERTABLE_PATH_PREFIXES = ["/api/", "/trpc/", "/uploads/"];

// Check if a path is from a route we actually serve (and thus worth alerting on)
function shouldAlertOnPath(path: string): boolean {
  return ALERTABLE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Extract Cloudflare headers from request
function getCloudflareHeaders(c: Context) {
  return {
    cfConnectingIp: c.req.header("CF-Connecting-IP"),
    cfCountry: c.req.header("CF-IPCountry"),
    cfRay: c.req.header("CF-Ray"),
  };
}

// Get user ID from session if available
function getUserId(c: Context): number | undefined {
  try {
    // Session is stored in c.get('session') by Hono session middleware
    const session = c.get("session");
    return session?.userId;
  } catch {
    return undefined;
  }
}

// Request logging middleware
export async function requestLogger(c: Context, next: Next) {
  const startTime = Date.now();

  // Extract request details
  const method = c.req.method;
  const path = c.req.path;

  // Skip logging static assets in development (reduce noise)
  // Set LOG_STATIC=true to log them
  const skipStatic = process.env.NODE_ENV === "development" && process.env.LOG_STATIC !== "true";
  if (skipStatic && (path.startsWith("/uploads/") || path.endsWith(".webp"))) {
    await next();
    return;
  }

  const userAgent = c.req.header("User-Agent");
  const ip = getClientIp(c);
  const cloudflare = getCloudflareHeaders(c);

  try {
    // Continue to next middleware/handler
    await next();

    // Calculate duration
    const duration = Date.now() - startTime;
    const status = c.res.status;
    const userId = getUserId(c);

    // Log request
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

    // Track errors for alerting (4xx and 5xx), but only for routes we serve
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
    // Log error and re-throw
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

    // Track error for alerting, but only for routes we serve
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
