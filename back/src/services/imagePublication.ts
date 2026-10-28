import { LocalFileStorage, createR2StorageFromEnv, getThumbnailFilename } from "../lib/storage";
import { logger } from "./logger";

// Copy before committing approval. Local files remain available if either storage or the
// database fails; a moderator can retry the same filenames without a background queue.
export async function copyImageToR2(filename: string): Promise<void> {
  const r2Storage = createR2StorageFromEnv();
  if (!r2Storage) throw new Error("R2 configuration missing");

  const localStorage = new LocalFileStorage();
  const thumbnailFilename = getThumbnailFilename(filename);
  const [image, thumbnail] = await Promise.all([
    localStorage.get(filename),
    localStorage.get(thumbnailFilename),
  ]);
  if (!image) throw new Error(`Local file not found: ${filename}`);

  const [imageBuffer, thumbnailBuffer] = await Promise.all([
    new Response(image.body).arrayBuffer(),
    thumbnail ? new Response(thumbnail.body).arrayBuffer() : null,
  ]);

  // Reuse the existing thumbnail; let storage generate one only if it is missing locally.
  await r2Storage.put(filename, imageBuffer, { skipThumbnail: thumbnailBuffer !== null });
  if (thumbnailBuffer) {
    await r2Storage.put(thumbnailFilename, thumbnailBuffer, { skipThumbnail: true });
  }
}

// Only run after approval commits. Keep the archival original in uploads/originals/.
export async function removePublishedLocalCopies(filename: string): Promise<void> {
  const localStorage = new LocalFileStorage();
  try {
    await Promise.all([
      localStorage.delete(filename),
      localStorage.delete(getThumbnailFilename(filename)),
    ]);
  } catch (error) {
    // Publication succeeded; failed housekeeping must not make approval look unsuccessful.
    logger.error({ error, filename }, "Failed to delete local copies after image publication");
  }
}
