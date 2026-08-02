import { createHmac } from "node:crypto";
import type { Context, Next } from "hono";
import { config as appConfig } from "../config";
import { logger } from "../services/logger";
import { classifyRequest } from "../services/botClassifier";
import { getClientIp } from "../utils/ip";

function getCloudflareHeaders(c: Context) {
  return {
    cfCountry: c.req.header("CF-IPCountry"),
    cfRay: c.req.header("CF-Ray"),
  };
}

function getUserId(c: Context): number | undefined {
  try {
    // Session is stored in c.get('session') by Hono session middleware
    const session = c.get("session");
    return session?.get("user")?.id;
  } catch {
    return undefined;
  }
}

const TILE_LOG_WINDOW_MS = 30 * 60 * 1000;
const TILE_SEEN_SWEEP_SIZE = 50_000;

// Last log time per visitorId for tile requests. Successful tile fetches are logged at most once
// per window per visitor: enough for distinct-visitor queries without a log line per tile.
const tileLogLastSeen = new Map<string, number>();

function shouldLogTileRequest(visitorId: string, now: number): boolean {
  const last = tileLogLastSeen.get(visitorId);
  if (last !== undefined && now - last < TILE_LOG_WINDOW_MS) return false;
  if (tileLogLastSeen.size >= TILE_SEEN_SWEEP_SIZE) {
    for (const [id, ts] of tileLogLastSeen) {
      if (now - ts >= TILE_LOG_WINDOW_MS) tileLogLastSeen.delete(id);
    }
  }
  tileLogLastSeen.set(visitorId, now);
  return true;
}

function visitorIdFor(ip: string): string {
  return createHmac("sha256", appConfig.COOKIE_SECRET).update(ip).digest("base64url").slice(0, 22);
}

export async function requestLogger(c: Context, next: Next) {
  const startTime = Date.now();
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
  const visitorId = visitorIdFor(ip);
  const cloudflare = getCloudflareHeaders(c);

  try {
    await next();

    const duration = Date.now() - startTime;
    const status = c.res.status;

    // Successful tile responses are rate-limited per visitor; tile errors always log below
    if (
      status < 400 &&
      path.startsWith("/api/tiles") &&
      !shouldLogTileRequest(visitorId, Date.now())
    ) {
      return;
    }

    const userId = getUserId(c);
    // After duration is measured, so the range scan never shows up as request latency
    const verdict = classifyRequest(ip, path, userAgent);

    // eslint-disable-next-line no-nested-ternary
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    logger[level]({
      method,
      path,
      status,
      duration,
      ip,
      visitorId,
      cfCountry: cloudflare.cfCountry,
      cfRay: cloudflare.cfRay,
      userId,
      botClass: verdict.botClass,
      botKind: verdict.botKind,
      // botOperator is derived from the User-Agent for declared bots, so a client controls its
      // value. It stays a field: promoting it to a Loki label would hand the index unbounded
      // cardinality.
      botOperator: verdict.botOperator,
      ...(verdict.impostor ? { impostor: true } : {}),
      // userAgent is wide and low-signal on success; keep it only on failures
      ...(status >= 400 ? { userAgent } : {}),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    // Reaching here means an unhandled throw bubbled past Hono's error handler,
    // so no real response was set (c.res lazily defaults to 200): treat as 500
    const status = 500;
    const verdict = classifyRequest(ip, path, userAgent);

    logger.error({
      method,
      path,
      status,
      duration,
      ip,
      visitorId,
      cfCountry: cloudflare.cfCountry,
      cfRay: cloudflare.cfRay,
      userAgent,
      botClass: verdict.botClass,
      botKind: verdict.botKind,
      botOperator: verdict.botOperator,
      ...(verdict.impostor ? { impostor: true } : {}),
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
