import { db } from "../database";
import { sessions, users, projects, overlays, uploadedFiles } from "../db/schema";
import { lt, and, eq, isNull } from "drizzle-orm";
import { deleteLocalImages } from "../lib/imageCleanup";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Keep rejected submissions for 90 days to allow appeals/review
const REJECTED_RETENTION_DAYS = 90;

// How long an uploaded image may sit on disk without an overlay referencing it. Submission follows
// upload within one form session, so anything past this was abandoned (or never intended to be
// submitted) and no other cleanup path can reach it.
const ORPHANED_UPLOAD_GRACE_HOURS = 24;

// Delete stored images that no overlay ever claimed, along with their attribution rows.
async function reapOrphanedUploads(): Promise<number> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - ORPHANED_UPLOAD_GRACE_HOURS);

  const orphans = await db
    .select({ id: uploadedFiles.id, filename: uploadedFiles.filename })
    .from(uploadedFiles)
    .leftJoin(overlays, eq(overlays.filename, uploadedFiles.filename))
    .where(and(lt(uploadedFiles.createdAt, cutoff), isNull(overlays.id)));

  let reaped = 0;
  for (const orphan of orphans) {
    try {
      await deleteLocalImages(orphan.filename, "both");
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, orphan.id));
      reaped += 1;
    } catch (error) {
      logger.error({ error, filename: orphan.filename }, "Failed to reap orphaned upload");
    }
  }
  return reaped;
}

export function startCleanupJob() {
  // Run immediately on startup
  runCleanup().catch((error: unknown) => {
    logger.error({ error }, "Initial cleanup failed");
  });

  // Schedule periodic cleanup
  setInterval(() => {
    runCleanup().catch((error: unknown) => {
      logger.error({ error }, "Scheduled cleanup failed");
    });
  }, CLEANUP_INTERVAL_MS);
}

async function runCleanup() {
  logger.info("Starting background cleanup job...");

  try {
    // 1. Clean up expired sessions
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

    // 5. Delete uploaded images that were never attached to an overlay
    const reapedUploads = await reapOrphanedUploads();

    logger.info(
      {
        timestamp: new Date().toISOString(),
        sessions: deletedSessions,
        orphanedUploads: reapedUploads,
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
