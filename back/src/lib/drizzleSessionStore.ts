import { db } from '../database'
import { sessions } from '../db/schema'
import { eq, lt } from 'drizzle-orm'

// AI : Drizzle-based session store for hono-sessions
// AI : Stores sessions in PostgreSQL for persistence across server restarts
export class DrizzleSessionStore {
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startCleanupInterval()
  }

  async getSessionById(sessionId: string): Promise<any> {
    try {
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)

      // AI : Check if session exists and is not expired
      if (!session) {
        return null
      }

      if (session.expiresAt < new Date()) {
        // AI : Session expired, delete it
        await this.deleteSession(sessionId)
        return null
      }

      return session.data
    } catch (error) {
      console.error('Failed to get session:', error)
      return null
    }
  }

  async createSession(sessionId: string, initialData: any): Promise<void> {
    try {
      // AI : Calculate expiry from session data or use default 30 days
      const expiresAt = initialData.expiresAt
        ? new Date(initialData.expiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await db.insert(sessions).values({
        id: sessionId,
        data: initialData,
        expiresAt,
      })
    } catch (error) {
      console.error('Failed to create session:', error)
      throw error
    }
  }

  async persistSessionData(sessionId: string, sessionData: any): Promise<void> {
    try {
      // AI : Update expiry if it changed in session data
      const expiresAt = sessionData.expiresAt
        ? new Date(sessionData.expiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await db
        .update(sessions)
        .set({
          data: sessionData,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId))
    } catch (error) {
      console.error('Failed to persist session data:', error)
      throw error
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId))
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  // AI : Clean up expired sessions periodically
  private startCleanupInterval() {
    // AI : Run cleanup every hour
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredSessions()
    }, 60 * 60 * 1000)
  }

  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const now = new Date()
      await db.delete(sessions).where(lt(sessions.expiresAt, now))
    } catch (error) {
      console.error('Failed to cleanup expired sessions:', error)
    }
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}
