import { logger } from "./logger";
import {
  LocalFileStorage,
  createR2StorageFromEnv,
  getThumbnailFilename,
  streamToBuffer,
} from "../lib/storage";

// Job queue for R2 migrations (in-memory for single-server deployment)
interface R2MigrationJob {
  filename: string;
  retryCount: number;
  addedAt: Date;
}

const migrationQueue: R2MigrationJob[] = [];
const MAX_RETRIES = 3;
const CONCURRENT_MIGRATIONS = 3;
const POLL_INTERVAL_MS = 1000;

let isProcessing = false;

export function queueR2Migration(filename: string): void {
  // Avoid duplicate jobs
  const exists = migrationQueue.some((job) => job.filename === filename);
  if (exists) {
    logger.warn({ filename }, "R2 migration already queued");
    return;
  }

  migrationQueue.push({
    filename,
    retryCount: 0,
    addedAt: new Date(),
  });

  logger.info({ filename, queueSize: migrationQueue.length }, "Queued R2 migration");
}

async function migrateFileToR2(filename: string): Promise<void> {
  const r2Storage = createR2StorageFromEnv();
  if (!r2Storage) {
    throw new Error("R2 configuration missing");
  }

  const localStorage = new LocalFileStorage();

  const [localFile, thumbnailFile] = await Promise.all([
    localStorage.get(filename),
    localStorage.get(getThumbnailFilename(filename)),
  ]);

  if (!localFile) {
    throw new Error(`Local file not found: ${filename}`);
  }

  const [imageBuffer, thumbnailBuffer] = await Promise.all([
    streamToBuffer(localFile.body),
    thumbnailFile ? streamToBuffer(thumbnailFile.body) : Promise.resolve(null),
  ]);

  // oxlint-disable-next-line no-unsafe-type-assertion
  const uploadPromises = [r2Storage.put(filename, imageBuffer.buffer as ArrayBuffer)];

  if (thumbnailBuffer) {
    const thumbnailFilename = getThumbnailFilename(filename);
    uploadPromises.push(
      // oxlint-disable-next-line no-unsafe-type-assertion
      r2Storage.put(thumbnailFilename, thumbnailBuffer.buffer as ArrayBuffer, {
        skipThumbnail: true,
      }),
    );
  }

  await Promise.all(uploadPromises);

  try {
    await localStorage.delete(filename);
    if (thumbnailFile) {
      await localStorage.delete(getThumbnailFilename(filename));
    }
  } catch (error) {
    logger.error({ error, filename }, "Failed to delete local files after R2 migration");
    // Don't throw - migration succeeded, deletion is cleanup
  }
}

async function processQueue(): Promise<void> {
  if (isProcessing || migrationQueue.length === 0) {
    return;
  }

  isProcessing = true;

  try {
    const batch = migrationQueue.splice(0, CONCURRENT_MIGRATIONS);

    await Promise.allSettled(
      batch.map(async (job) => {
        try {
          logger.info({ filename: job.filename }, "Starting R2 migration");
          await migrateFileToR2(job.filename);
          logger.info({ filename: job.filename }, "R2 migration complete");
        } catch (error) {
          job.retryCount += 1;

          if (job.retryCount < MAX_RETRIES) {
            logger.warn(
              { error, filename: job.filename, retryCount: job.retryCount },
              "R2 migration failed, retrying",
            );
            migrationQueue.push(job);
          } else {
            logger.error(
              { error, filename: job.filename, retryCount: job.retryCount },
              "R2 migration failed after max retries",
            );
          }
        }
      }),
    );
  } finally {
    isProcessing = false;
  }
}

export function startR2MigrationService(): void {
  logger.info("Starting R2 migration service...");

  setInterval(() => {
    processQueue().catch((error: unknown) => {
      logger.error({ error }, "Error in R2 migration worker");
    });
  }, POLL_INTERVAL_MS);
}
