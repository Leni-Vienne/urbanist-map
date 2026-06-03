import { db } from "../database";
import { scheduledDeletions } from "../db/schema";
import { lte, eq } from "drizzle-orm";
import { appendFile, readdir, unlink } from "node:fs/promises";
import { LocalFileStorage, R2StorageS3, getThumbnailFilename } from "./storage";
import type { StorageInterface } from "./types";

const THUMBNAIL_RETENTION_DAYS = 15;

function createR2Storage(): R2StorageS3 {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("Missing R2 configuration environment variables");
  }
  return new R2StorageS3({ endpoint, accessKeyId, secretAccessKey, bucketName });
}

/**
 * Delete full image and/or thumbnail from a single storage backend.
 * Failures are logged but not thrown, storage.delete() handles its own error swallowing.
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

/**
 * Delete the retained local original for an image, if one was kept.
 * Originals live at uploads/originals/<base>.<originalExt>. Only the compressed
 * filename is known at cleanup time, so match on the shared base.
 */
async function deleteLocalOriginal(compressedFilename: string): Promise<void> {
  const base = compressedFilename.replace(/\.[^./]+$/, "");
  try {
    const entries = await readdir("./uploads/originals");
    await Promise.all(
      entries
        .filter((name) => name.replace(/\.[^./]+$/, "") === base)
        .map(async (name) =>
          unlink(`./uploads/originals/${name}`).catch((error: unknown) => {
            console.warn(`Failed to delete original ${name}:`, error);
          }),
        ),
    );
  } catch {
    // originals dir absent or unreadable: nothing to clean
  }
}

async function appendOrphanLog(failedFiles: string[]): Promise<void> {
  if (failedFiles.length === 0) return;
  const entry = `${new Date().toISOString()} - Failed to delete: ${failedFiles.join(", ")}\n`;
  await appendFile("./orphaned_files.txt", entry).catch((error: unknown) => {
    console.error("Failed to write to orphaned files log:", error);
  });
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function scheduleThumbnailDeletion(overlayId: string, filename: string): Promise<void> {
  const deletionDate = daysFromNow(THUMBNAIL_RETENTION_DAYS);
  await db
    .insert(scheduledDeletions)
    .values({ overlayId, filename, deletionDate, deletionType: "thumbnail" });
  console.log(`Scheduled thumbnail deletion for ${filename} on ${deletionDate.toISOString()}`);
}

/**
 * Cleanup after a pending overlay was rejected.
 * Pending overlays are never migrated to R2, so the full image lives only in local storage.
 * The thumbnail is retained for a grace period (visible in the user's "rejected" view).
 */
export async function cleanupRejectedPendingOverlay(
  overlayId: string,
  filename: string,
): Promise<void> {
  await deleteLocalImages(filename, "full");
  await scheduleThumbnailDeletion(overlayId, filename);
}

/**
 * Cleanup after an approved overlay was replaced by a new approved overlay.
 * The original full image lives in R2 (production) or local (dev), the thumbnail is always local.
 * The thumbnail is retained briefly so any in-flight client renders don't 404.
 */
export async function cleanupReplacedApprovedOverlay(
  overlayId: string,
  filename: string,
): Promise<void> {
  await deleteImages(filename, "full");
  await scheduleThumbnailDeletion(overlayId, filename);
}

/**
 * Execute pending deletions (run by background job/cron).
 * Deletes from both local and R2 storage, rejected/replaced overlay thumbnails are always local,
 * approved overlay images are in R2.
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
  // TODO: storage.delete() swallows its own errors, so `failed` only captures DB-level failures.
  // For accurate per-file tracking, storage.delete() should throw on real errors (not 404s).

  const localStorage = new LocalFileStorage();
  const isProduction = process.env.NODE_ENV === "production";
  const r2Storage = isProduction ? createR2Storage() : null;

  for (const item of pendingDeletions) {
    try {
      // Full images may be in local (pending overlays) or R2 (approved overlays), try both.
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
  if (deleteType === "full" || deleteType === "both") {
    await deleteLocalOriginal(filename);
  }
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
  if (deleteType === "full" || deleteType === "both") {
    await deleteLocalOriginal(filename);
  }
  await appendOrphanLog(failed);
}
