import { db } from "../database";
import { overlays, uploadedFiles } from "../db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { stat } from "node:fs/promises";
import { getThumbnailFilename } from "./storage";

// Cap the on-disk footprint a single user can stage while their uploads await moderation.
// Pending images (compressed file + thumbnail + uncapped pre-compression original) live only in
// local storage until approval, so this bounds local disk per user independently of the per-file
// size cap and the pending-count limit. Tune freely; it is a safety ceiling, not a product limit.
const MAX_PENDING_STORAGE_BYTES = 200 * 1024 * 1024;

const UPLOADS_DIR = "./uploads";
const ORIGINALS_DIR = "./uploads/originals";

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    // Missing file (already deleted, or thumbnail/original never written): contributes nothing.
    return 0;
  }
}

// Files an upload is charged for: everything still local and awaiting a moderation decision.
// A row with no overlay is an upload that was stored but never submitted; it occupies disk just
// the same. Approved overlays are excluded because their compressed image and thumbnail have
// migrated to R2 and their retained original is permanent — charging it would let a contributor's
// accepted work permanently consume the allowance for staging new work.
async function chargeableUploads(
  userId: string,
): Promise<{ filename: string; originalFilename: string | null }[]> {
  return (
    db
      .select({
        filename: uploadedFiles.filename,
        originalFilename: uploadedFiles.originalFilename,
      })
      .from(uploadedFiles)
      .leftJoin(overlays, eq(overlays.filename, uploadedFiles.filename))
      .where(
        and(
          eq(uploadedFiles.uploaderId, userId),
          or(isNull(overlays.id), eq(overlays.status, "pending")),
        ),
      )
      // A filename can be referenced by more than one overlay row (replacement chains); collapse so
      // one stored file is charged once.
      .groupBy(uploadedFiles.filename, uploadedFiles.originalFilename)
  );
}

async function pendingStorageUsed(userId: string): Promise<number> {
  const rows = await chargeableUploads(userId);

  let total = 0;
  for (const { filename, originalFilename } of rows) {
    total += await fileSize(`${UPLOADS_DIR}/${filename}`);
    total += await fileSize(`${UPLOADS_DIR}/${getThumbnailFilename(filename)}`);
    if (originalFilename) {
      total += await fileSize(`${ORIGINALS_DIR}/${originalFilename}`);
    }
  }
  return total;
}

// True when storing `incomingBytes` more would push the user past their pending storage quota.
// Fails open (returns false) on any error so a transient DB/FS fault never blocks a legitimate
// upload; the rate limit and pending-count limit still apply as independent backstops.
export async function exceedsPendingStorageQuota(
  userId: string,
  incomingBytes: number,
): Promise<boolean> {
  try {
    const used = await pendingStorageUsed(userId);
    return used + incomingBytes > MAX_PENDING_STORAGE_BYTES;
  } catch (error) {
    console.error("Failed to evaluate pending storage quota:", error);
    return false;
  }
}
