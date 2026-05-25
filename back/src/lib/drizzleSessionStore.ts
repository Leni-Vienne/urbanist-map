import { db } from "../database";
import { sessions } from "../db/schema";
import { eq, lt } from "drizzle-orm";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cleanupInterval: NodeJS.Timeout | null = null;

async function getSessionById(sessionId: string) {
  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

    if (!session) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      await deleteSession(sessionId);
      return null;
    }

    return session.data;
  } catch (error) {
    console.error("Failed to get session:", error);
    return null;
  }
}

async function createSession(sessionId: string, initialData: any): Promise<void> {
  try {
    const { shouldPersist, expiresAt } = prepareSessionForPersistence(initialData);
    if (!shouldPersist) return;

    await db.insert(sessions).values({
      id: sessionId,
      data: initialData,
      expiresAt,
    });
  } catch (error) {
    console.error("Failed to create session:", error);
    throw error;
  }
}

async function persistSessionData(
  sessionId: string,
  sessionData: Record<string, any>,
): Promise<void> {
  try {
    const { shouldPersist, expiresAt } = prepareSessionForPersistence(sessionData);
    if (!shouldPersist) return;

    // UPSERT covers the case where persistSessionData lands before createSession,
    // or after a row was reaped by cleanupExpiredSessions.
    await db
      .insert(sessions)
      .values({
        id: sessionId,
        data: sessionData,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          data: sessionData,
          expiresAt,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    // Swallowed: a failed persist shouldn't break the request. Session still works in-memory.
    console.error("Failed to persist session data:", error);
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch (error) {
    console.error("Failed to delete session:", error);
  }
}

function prepareSessionForPersistence(data: unknown): { shouldPersist: boolean; expiresAt: Date } {
  // hono-sessions wraps the user payload inside `_data`
  // eslint-disable-next-line no-underscore-dangle
  const inner = (
    data as {
      _data?: { user?: unknown; osmOauth?: unknown; expiresAt?: string | number | Date };
    }
  )._data;

  // Anonymous visitors get no DB row to keep the table small. Exception: a session
  // mid-OAuth carries the OSM CSRF state, which must survive the redirect to
  // openstreetmap.org and back, so persist it with a short expiry.
  if (!inner?.user) {
    if (inner?.osmOauth) {
      return { shouldPersist: true, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
    }
    return { shouldPersist: false, expiresAt: new Date() };
  }

  let expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MS);
  if (inner.expiresAt) {
    const parsed = new Date(inner.expiresAt);
    if (!Number.isNaN(parsed.getTime())) {
      expiresAt = parsed;
    }
  }

  return { shouldPersist: true, expiresAt };
}

async function cleanupExpiredSessions(): Promise<void> {
  try {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch (error) {
    console.error("Failed to cleanup expired sessions:", error);
  }
}

export function startSessionCleanup(): void {
  if (cleanupInterval) return;

  // Run once on startup to clear sessions left over from previous runs.
  void cleanupExpiredSessions();
  cleanupInterval = setInterval(() => {
    void cleanupExpiredSessions();
  }, CLEANUP_INTERVAL_MS);
}

// Object form consumed by hono-sessions' sessionMiddleware.
export const sessionStore = {
  getSessionById,
  createSession,
  persistSessionData,
  deleteSession,
};
