import { db } from "../database";
import { sessions, users } from "../db/schema";
import { lt, and, eq } from "drizzle-orm";

// AI : Run cleanup every 24 hours
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startCleanupJob() {
  // AI : Run immediately on startup
  runCleanup().catch((error) => console.error("Initial cleanup failed:", error));

  // AI : Schedule periodic cleanup
  setInterval(() => {
    runCleanup().catch((error) => console.error("Scheduled cleanup failed:", error));
  }, CLEANUP_INTERVAL_MS);
}

async function runCleanup() {
  console.log("Starting background cleanup job...");

  try {
    // 1. Clean up expired sessions
    // AI : Delete sessions where expires_at < NOW
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); // stored as timestamp, expects Date object

    // 2. Clean up unverified users older than 30 days
    // AI : These are likely spam or abandoned registrations
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await db
      .delete(users)
      .where(and(eq(users.emailVerified, false), lt(users.createdAt, thirtyDaysAgo)));

    console.log("Cleanup complete:", {
      // AI : Drizzle delete result object might vary by driver, usually has rowCount or similar if supported
      // AI : Using generic log message safe for all
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error during cleanup job:", error);
  }
}
