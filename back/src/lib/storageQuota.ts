import { db } from "../database";
import { overlays } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { readdir, stat } from "node:fs/promises";

// Cap the on-disk footprint a single user can stage while their uploads await moderation.
// Pending images (compressed file + thumbnail + uncapped pre-compression original) live only in
// local storage until approval, so this bounds local disk per user independently of the per-file
// size cap and the pending-count limit. Tune freely; it is a safety ceiling, not a product limit.
const MAX_PENDING_STORAGE_BYTES = 200 * 1024 * 1024;

const UPLOADS_DIR = "./uploads";
const THUMBNAILS_DIR = "./uploads/thumbnails";
const ORIGINALS_DIR = "./uploads/originals";

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    // Missing file (already deleted, or thumbnail/original never written): contributes nothing.
    return 0;
  }
}

// Sum the bytes the originals dir holds for the given base names. Originals keep their source
// extension (jpg/png/webp), so they can't be addressed by the compressed filename directly; we
// list the dir once (names only, cheap) and stat just the entries whose base matches a pending
// overlay, rather than statting the whole archive.
async function originalsFootprint(bases: Set<string>): Promise<number> {
  if (bases.size === 0) return 0;
  let total = 0;
  try {
    const names = await readdir(ORIGINALS_DIR);
    for (const name of names) {
      if (bases.has(baseName(name))) {
        total += await fileSize(`${ORIGINALS_DIR}/${name}`);
      }
    }
  } catch {
    // Originals dir may not exist yet.
  }
  return total;
}

async function pendingStorageUsed(userId: string): Promise<number> {
  const pending = await db
    .select({ filename: overlays.filename })
    .from(overlays)
    .where(and(eq(overlays.authorId, userId), eq(overlays.status, "pending")));

  let total = 0;
  const bases = new Set<string>();
  for (const { filename } of pending) {
    total += await fileSize(`${UPLOADS_DIR}/${filename}`);
    total += await fileSize(`${THUMBNAILS_DIR}/${filename}`);
    bases.add(baseName(filename));
  }
  total += await originalsFootprint(bases);
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
