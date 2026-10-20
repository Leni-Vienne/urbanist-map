import { readdir } from "node:fs/promises";
import {
  LocalFileStorage,
  createR2StorageFromEnv,
  getThumbnailFilename,
  type R2StorageS3,
} from "./storage";
import type { StorageInterface } from "./types";

function createR2Storage(): R2StorageS3 {
  const storage = createR2StorageFromEnv();
  if (!storage) {
    throw new Error("Missing R2 configuration environment variables");
  }
  return storage;
}

/**
 * Delete an image and its thumbnail from a single storage backend.
 */
async function deleteFilesFromStorage(storage: StorageInterface, filename: string): Promise<void> {
  await Promise.all([storage.delete(filename), storage.delete(getThumbnailFilename(filename))]);
}

/**
 * Delete the retained local original for an image, if one was kept.
 * Originals live at uploads/originals/<base>.<originalExt>. Only the compressed
 * filename is known at cleanup time, so match on the shared base.
 */
async function deleteLocalOriginal(compressedFilename: string): Promise<void> {
  const base = compressedFilename.replace(/\.[^./]+$/, "");
  // oxlint-disable-next-line init-declarations
  let entries: string[];
  try {
    entries = await readdir("./uploads/originals");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const localStorage = new LocalFileStorage();
  await Promise.all(
    entries
      .filter((name) => name.replace(/\.[^./]+$/, "") === base)
      .map(async (name) => localStorage.delete(`originals/${name}`)),
  );
}

/**
 * Delete images immediately from local storage only.
 * Used for pending uploads that were never migrated to R2.
 */
export async function deleteLocalImages(filename: string): Promise<void> {
  await deleteFromStorageBackends(filename, [new LocalFileStorage()]);
}

export async function deleteImagesEverywhere(filename: string): Promise<void> {
  const storageBackends: StorageInterface[] = [new LocalFileStorage()];
  if (process.env.NODE_ENV === "production") {
    storageBackends.push(createR2Storage());
  }
  await deleteFromStorageBackends(filename, storageBackends);
}

async function deleteFromStorageBackends(
  filename: string,
  storageBackends: StorageInterface[],
): Promise<void> {
  async function deleteFromStorage(storage: StorageInterface): Promise<void> {
    return deleteFilesFromStorage(storage, filename);
  }

  const results = await Promise.allSettled([
    ...storageBackends.map(deleteFromStorage),
    deleteLocalOriginal(filename),
  ]);
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  // Leave the upload's attribution row for the daily orphan sweep to retry failed deletions.
  if (failures.length > 0) throw new AggregateError(failures, `Failed to delete image ${filename}`);
}
