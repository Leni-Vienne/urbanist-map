import { sessionMiddleware, type SessionData, type Store } from "hono-sessions";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

export const SESSION_DURATION_SHORT = 7 * 24 * 60 * 60;
export const SESSION_DURATION_LONG = 30 * 24 * 60 * 60;

export function createSessionMiddleware(
  store: Store,
  encryptionKey: string,
  isDevelopment = process.env.NODE_ENV === "development",
): MiddlewareHandler<AppEnv> {
  return sessionMiddleware({
    store,
    sessionCookieName: "session",
    encryptionKey,
    expireAfterSeconds: SESSION_DURATION_LONG,
    cookieOptions: {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: isDevelopment ? "Lax" : "None",
      path: "/",
      // Keep the cookie across browser restarts. The store enforces each login's
      // absolute 7- or 30-day expiry, even though the middleware refreshes this cookie.
      maxAge: SESSION_DURATION_LONG,
    },
  });
}

interface SessionPersistencePolicy {
  shouldPersist: boolean;
  expiresAt: Date;
}

export function prepareSessionForPersistence(
  data: SessionData<unknown>,
  now = Date.now(),
): SessionPersistencePolicy {
  // Each hono-sessions entry is stored as { value, flash } inside `_data`.
  // oxlint-disable-next-line no-underscore-dangle
  const inner = data._data;

  if (!inner.user?.value) {
    // OSM's CSRF state must survive the redirect, but anonymous visits need no row.
    if (inner.osmOauth?.value) {
      return { shouldPersist: true, expiresAt: new Date(now + 10 * 60 * 1000) };
    }
    return { shouldPersist: false, expiresAt: new Date(now) };
  }

  let expiresAt = new Date(now + SESSION_DURATION_LONG * 1000);
  const expiry = inner.expiresAt?.value;
  if (typeof expiry === "string" || typeof expiry === "number" || expiry instanceof Date) {
    const parsed = new Date(expiry);
    if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
  }

  return { shouldPersist: true, expiresAt };
}
