import { db } from "../database";
import { sessions, users, projects, overlays } from "../db/schema";
import { lt, and, eq } from "drizzle-orm";
import { logger } from "./logger";

// Run cleanup every 24 hours
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Keep rejected submissions for 90 days to allow appeals/review
const REJECTED_RETENTION_DAYS = 90;

export function startCleanupJob() {
  // Run immediately on startup
  runCleanup().catch((error) => {
    logger.error({ error }, "Initial cleanup failed");
  });

  // Schedule periodic cleanup
  setInterval(() => {
    runCleanup().catch((error) => {
      logger.error({ error }, "Scheduled cleanup failed");
    });
  }, CLEANUP_INTERVAL_MS);
}

async function runCleanup() {
  logger.info("Starting background cleanup job...");

  try {
    // 1. Clean up expired sessions
    // Delete sessions where expires_at < NOW
    const deletedSessions = await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

    // 2. Clean up unverified users older than 24 hours
    // Short window to prevent email squatting - users can re-register if they miss it
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const deletedUsers = await db
      .delete(users)
      .where(and(eq(users.emailVerified, false), lt(users.createdAt, oneDayAgo)));

    // 3. Clean up rejected projects older than 90 days
    // Keep recent rejections in case user wants to appeal/resubmit
    const rejectedCutoff = new Date();
    rejectedCutoff.setDate(rejectedCutoff.getDate() - REJECTED_RETENTION_DAYS);

    const deletedProjects = await db
      .delete(projects)
      .where(and(eq(projects.status, "rejected"), lt(projects.updatedAt, rejectedCutoff)));

    // 4. Clean up rejected overlays older than 90 days
    const deletedOverlays = await db
      .delete(overlays)
      .where(and(eq(overlays.status, "rejected"), lt(overlays.updatedAt, rejectedCutoff)));

    logger.info(
      {
        timestamp: new Date().toISOString(),
        sessions: deletedSessions,
        unverifiedUsers: deletedUsers,
        rejectedProjects: deletedProjects,
        rejectedOverlays: deletedOverlays,
      },
      "Cleanup complete",
    );
  } catch (error) {
    logger.error({ error }, "Error during cleanup job");
  }
}
