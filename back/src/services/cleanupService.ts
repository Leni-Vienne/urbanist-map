import { db } from "../database";
import { sessions, users, projects, overlays, uploadedFiles } from "../db/schema";
import { lt, and, eq, isNull, inArray, or } from "drizzle-orm";
import { deleteImagesEverywhere } from "../lib/imageCleanup";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// One week to review rejection/replacement feedback. Approved contributions do not expire.
const REVIEWED_RETENTION_DAYS = 7;

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
      // Replaced images may have lived in R2; the same sweep also retries cleanup after a
      // reviewed row was removed but its file deletion failed.
      await deleteImagesEverywhere(orphan.filename);
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, orphan.id));
      reaped += 1;
    } catch (error) {
      logger.error({ error, filename: orphan.filename }, "Failed to reap orphaned upload");
    }
  }
  return reaped;
}

export async function pruneReviewedSubmissions(cutoff: Date): Promise<void> {
  const removedImages = await db.transaction(async (tx) => {
    // Lock the parents so a resubmission cannot race their cascading deletion. Collect the
    // child filenames before deleting projects, including children removed by that cascade.
    const expiredProjects = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.status, "rejected"), lt(projects.updatedAt, cutoff)))
      .for("update");
    const expiredProjectIds = expiredProjects.map((project) => project.id);
    const expiredImages = and(
      inArray(overlays.status, ["rejected", "replaced"]),
      lt(overlays.updatedAt, cutoff),
    );
    const removed = await tx
      .delete(overlays)
      .where(or(expiredImages, inArray(overlays.projectId, expiredProjectIds)))
      .returning({ filename: overlays.filename });
    await tx.delete(projects).where(inArray(projects.id, expiredProjectIds));
    return removed;
  });

  for (const image of removedImages) {
    try {
      await deleteImagesEverywhere(image.filename);
    } catch (error) {
      logger.error({ error, filename: image.filename }, "Failed to clean up reviewed image");
    }
  }
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

    // 3. Expire rejected/replaced submissions and their full images and thumbnails together.
    const reviewedCutoff = new Date();
    reviewedCutoff.setDate(reviewedCutoff.getDate() - REVIEWED_RETENTION_DAYS);
    await pruneReviewedSubmissions(reviewedCutoff);

    // 4. Delete abandoned uploads and finish file cleanup for rows removed above.
    const reapedUploads = await reapOrphanedUploads();

    logger.info(
      {
        timestamp: new Date().toISOString(),
        sessions: deletedSessions,
        orphanedUploads: reapedUploads,
        unverifiedUsers: deletedUsers,
      },
      "Cleanup complete",
    );
  } catch (error) {
    logger.error({ error }, "Error during cleanup job");
  }
}
