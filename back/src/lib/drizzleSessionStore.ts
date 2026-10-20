import { db } from "../database";
import { sessions } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import type { SessionData } from "hono-sessions";
import { prepareSessionForPersistence } from "./sessionPolicy";

async function getSessionById(sessionId?: string) {
  if (!sessionId) return null;
  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

    if (!session) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      await deleteSession(sessionId);
      return null;
    }

    // The JSONB column read via bun-sql comes back as a frozen object. hono-sessions mutates the
    // cache in place (_expire, _accessed, _data), so hand it a mutable clone to avoid throwing
    // "Attempted to assign to readonly property" on every authenticated request.
    return structuredClone(session.data);
  } catch (error) {
    console.error("Failed to get session:", error);
    return null;
  }
}

async function createSession(sessionId: string, initialData: SessionData): Promise<void> {
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

async function persistSessionData(sessionId: string, sessionData: SessionData): Promise<void> {
  try {
    const { shouldPersist, expiresAt } = prepareSessionForPersistence(sessionData);
    if (!shouldPersist) {
      // A consumed OAuth state must also disappear from any previously stored row.
      // Anonymous visits with no OAuth entry still avoid database writes.
      // oxlint-disable-next-line no-underscore-dangle
      if (sessionData._data.osmOauth) await deleteSession(sessionId);
      return;
    }

    // UPSERT covers the case where persistSessionData lands before createSession,
    // or after a row was removed by the daily cleanup job.
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

// Drops every stored session belonging to a user, revoking credentials already issued.
export async function deleteUserSessions(userId: string): Promise<void> {
  try {
    await db.delete(sessions).where(sql`data->'_data'->'user'->'value'->>'id' = ${userId}`);
  } catch (error) {
    console.error("Failed to delete user sessions:", error);
  }
}

// Object form consumed by hono-sessions' sessionMiddleware.
export const sessionStore = {
  getSessionById,
  createSession,
  persistSessionData,
  deleteSession,
};
