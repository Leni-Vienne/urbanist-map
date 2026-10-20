import { db } from "../database";
import { overlays, uploadedFiles } from "../db/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { stat } from "node:fs/promises";
import { getThumbnailFilename } from "./storage";

// Count pending, abandoned and retained rejected uploads, including their originals and thumbnails.
// Rejection must not free the allowance while its files still occupy disk.
const MAX_PENDING_STORAGE_BYTES = 200 * 1024 * 1024;

const UPLOADS_DIR = "./uploads";
const ORIGINALS_DIR = "./uploads/originals";

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch (error) {
    // Only a missing file contributes nothing. Other filesystem errors must block the upload.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

// Files an upload is charged for: unreviewed uploads and retained rejected submissions.
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
          or(isNull(overlays.id), inArray(overlays.status, ["pending", "rejected"])),
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
// Failure to read usage must fail the upload rather than silently bypassing the quota.
export async function exceedsPendingStorageQuota(
  userId: string,
  incomingBytes: number,
): Promise<boolean> {
  const used = await pendingStorageUsed(userId);
  return used + incomingBytes > MAX_PENDING_STORAGE_BYTES;
}
