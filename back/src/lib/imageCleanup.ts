import { db } from "../database";
import { scheduledDeletions } from "../db/schema";
import { lte, eq } from "drizzle-orm";
import { appendFile } from "node:fs/promises";
import { LocalFileStorage, R2StorageS3, getThumbnailFilename } from "./storage";
import type { StorageInterface } from "./types";

// ============================================================================
// HELPERS
// ============================================================================

function createR2Storage(): R2StorageS3 {
  return new R2StorageS3({
    endpoint: process.env.R2_ENDPOINT!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
  });
}

/**
 * Delete full image and/or thumbnail from a single storage backend.
 * Failures are logged but not thrown — storage.delete() handles its own error swallowing.
 * Returns the list of filenames that could not be deleted.
 */
async function deleteFilesFromStorage(
  storage: StorageInterface,
  filename: string,
  deleteType: "full" | "thumbnail" | "both",
): Promise<string[]> {
  const thumbnailFilename = getThumbnailFilename(filename);
  const failed: string[] = [];

  if (deleteType === "full" || deleteType === "both") {
    try {
      await storage.delete(filename);
    } catch (error) {
      console.error(`Failed to delete full image ${filename}:`, error);
      failed.push(filename);
    }
  }

  if (deleteType === "thumbnail" || deleteType === "both") {
    try {
      await storage.delete(thumbnailFilename);
    } catch (error) {
      console.error(`Failed to delete thumbnail ${thumbnailFilename}:`, error);
      failed.push(thumbnailFilename);
    }
  }

  return failed;
}

async function appendOrphanLog(failedFiles: string[]): Promise<void> {
  if (failedFiles.length === 0) return;
  const entry = `${new Date().toISOString()} - Failed to delete: ${failedFiles.join(", ")}\n`;
  await appendFile("./orphaned_files.txt", entry).catch((error) => {
    console.error("Failed to write to orphaned files log:", error);
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Schedule image deletion for a future date (used for replaced/rejected overlays).
 */
export async function scheduleImageCleanup(
  overlayId: string,
  filename: string,
  deletionDate: Date,
  deletionType: "full" | "thumbnail" | "both",
): Promise<void> {
  await db.insert(scheduledDeletions).values({ overlayId, filename, deletionDate, deletionType });
  console.log(
    `Scheduled ${deletionType} deletion for ${filename} on ${deletionDate.toISOString()}`,
  );
}

/**
 * Execute pending deletions (run by background job/cron).
 * Deletes from both local and R2 storage — rejected/replaced overlay thumbnails are always local,
 * approved overlay images are in R2.
 *
 * Note: storage.delete() currently swallows its own errors internally, so the failed counter
 * only catches errors thrown before or after the storage calls (e.g. DB errors).
 * For accurate per-file failure tracking, storage.delete() would need to throw on real errors
 * and return/throw only on genuine failures (not missing-file 404s).
 */
export async function executePendingDeletions(): Promise<{ deleted: number; failed: number }> {
  const now = new Date();
  let deleted = 0;
  let failed = 0;

  const pendingDeletions = await db
    .select()
    .from(scheduledDeletions)
    .where(lte(scheduledDeletions.deletionDate, now));

  console.log(`Found ${pendingDeletions.length} pending deletions to process`);

  const localStorage = new LocalFileStorage();
  const isProduction = process.env.NODE_ENV === "production";
  const r2Storage = isProduction ? createR2Storage() : null;

  for (const item of pendingDeletions) {
    try {
      // Full images may be in local (pending overlays) or R2 (approved overlays) — try both.
      // Thumbnails are always local (not migrated to R2).
      const fullOrBoth = item.deletionType === "full" || item.deletionType === "both";
      const thumbnailOrBoth = item.deletionType === "thumbnail" || item.deletionType === "both";

      if (fullOrBoth) {
        await deleteFilesFromStorage(localStorage, item.filename, "full");
        if (r2Storage) await deleteFilesFromStorage(r2Storage, item.filename, "full");
      }
      if (thumbnailOrBoth) {
        await deleteFilesFromStorage(localStorage, item.filename, "thumbnail");
      }

      await db.delete(scheduledDeletions).where(eq(scheduledDeletions.id, item.id));
      deleted += 1;
    } catch (error) {
      console.error(`Failed to process deletion for ${item.filename}:`, error);
      failed += 1;
    }
  }

  console.log(`Cleanup complete: ${deleted} deleted, ${failed} failed`);
  return { deleted, failed };
}

/**
 * Delete images immediately from local storage only.
 * Used for rejected/deleted pending overlays that were never migrated to R2.
 */
export async function deleteLocalImages(
  filename: string,
  deleteType: "full" | "thumbnail" | "both",
): Promise<void> {
  const storage = new LocalFileStorage();
  const failed = await deleteFilesFromStorage(storage, filename, deleteType);
  await appendOrphanLog(failed);
}

/**
 * Delete images immediately from the active storage backend (R2 in production, local in dev).
 */
export async function deleteImages(
  filename: string,
  deleteType: "full" | "thumbnail" | "both",
): Promise<void> {
  const storage =
    process.env.NODE_ENV === "production" ? createR2Storage() : new LocalFileStorage();
  const failed = await deleteFilesFromStorage(storage, filename, deleteType);
  await appendOrphanLog(failed);
}

/**
 * Return a Date N days from now.
 */
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}
