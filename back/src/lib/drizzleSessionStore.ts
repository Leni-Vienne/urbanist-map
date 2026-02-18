import { db } from "../database";
import { sessions } from "../db/schema";
import { eq, lt } from "drizzle-orm";

// AI : Drizzle-based session store for hono-sessions
// AI : Stores sessions in PostgreSQL for persistence across server restarts
export class DrizzleSessionStore {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // AI : Run cleanup immediately on startup to clear sessions from previous runs
    this.cleanupExpiredSessions();
    this.startCleanupInterval();
  }

  async getSessionById(sessionId: string) {
    try {
      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

      // AI : Check if session exists and is not expired
      if (!session) {
        return null;
      }

      if (session.expiresAt < new Date()) {
        // AI : Session expired, delete it
        await this.deleteSession(sessionId);
        return null;
      }

      return session.data;
    } catch (error) {
      console.error("Failed to get session:", error);
      return null;
    }
  }

  async createSession(sessionId: string, initialData: any): Promise<void> {
    try {
      const { shouldPersist, expiresAt } = this.prepareSessionForPersistence(initialData);

      if (!shouldPersist) {
        return;
      }

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

  async persistSessionData(sessionId: string, sessionData: Record<string, any>): Promise<void> {
    try {
      const { shouldPersist, expiresAt } = this.prepareSessionForPersistence(sessionData);

      if (!shouldPersist) {
        return;
      }

      // AI : CRITICAL FIX: Use UPSERT to handle both create and update cases
      // AI : This prevents session loss when persistSessionData is called before createSession
      // AI : or when a session needs to be recreated after expiry
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
      console.error("Failed to persist session data:", error);
      // AI : Don't throw - failing to persist session data shouldn't break the request
      // The session will still work in-memory, just won't be persisted to DB
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }

  private prepareSessionForPersistence(data: any): { shouldPersist: boolean; expiresAt: Date } {
    // AI : hono-sessions stores user data in _data property
    const typedData = data as {
      _data?: { user?: unknown; expiresAt?: string | number | Date };
    };
    const userData = typedData?._data?.user;

    // AI : Skip persisting empty sessions (anonymous visitors)
    // AI : Only logged-in users need database-backed sessions
    if (!userData) {
      return { shouldPersist: false, expiresAt: new Date() };
    }

    // AI : Safely parse expiry date, fallback to 30 days if invalid
    const rawExpiry = typedData?._data?.expiresAt;
    const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    let expiresAt = defaultExpiry;

    if (rawExpiry) {
      const parsed = new Date(rawExpiry);
      if (!Number.isNaN(parsed.getTime())) {
        expiresAt = parsed;
      }
    }

    return { shouldPersist: true, expiresAt };
  }

  // AI : Clean up expired sessions periodically
  private startCleanupInterval() {
    // AI : Run cleanup every hour
    this.cleanupInterval = setInterval(
      async () => {
        await this.cleanupExpiredSessions();
      },
      60 * 60 * 1000,
    );
  }

  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const now = new Date();
      await db.delete(sessions).where(lt(sessions.expiresAt, now));
    } catch (error) {
      console.error("Failed to cleanup expired sessions:", error);
    }
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
