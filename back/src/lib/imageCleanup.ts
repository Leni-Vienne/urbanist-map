import { db } from '../database';
import { scheduledDeletions } from '../db/schema';
import { lte, eq } from 'drizzle-orm';
import { LocalFileStorage, R2StorageS3, getThumbnailFilename } from './storage';

// AI : Schedule image deletion for a future date (used for replaced/rejected overlays)
export async function scheduleImageCleanup(
  overlayId: string,
  filename: string,
  deletionDate: Date,
  deletionType: 'full' | 'thumbnail' | 'both'
): Promise<void> {
  try {
    await db.insert(scheduledDeletions).values({
      overlayId,
      filename,
      deletionDate,
      deletionType
    });

    console.log(`Scheduled ${deletionType} deletion for ${filename} on ${deletionDate.toISOString()}`);
  } catch (error) {
    console.error('Failed to schedule image cleanup:', error);
    throw error;
  }
}

// AI : Execute pending deletions (run by background job/cron)
export async function executePendingDeletions(): Promise<{ deleted: number; failed: number }> {
  const now = new Date();
  let deleted = 0;
  let failed = 0;

  try {
    // AI : Find all deletions that are due
    const pendingDeletions = await db
      .select()
      .from(scheduledDeletions)
      .where(lte(scheduledDeletions.deletionDate, now));

    console.log(`Found ${pendingDeletions.length} pending deletions to process`);

    // AI : Initialize storage instances
    const r2Storage = new R2StorageS3({
      endpoint: process.env.R2_ENDPOINT!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucketName: process.env.R2_BUCKET_NAME!
    });

    for (const item of pendingDeletions) {
      try {
        const thumbnailFilename = getThumbnailFilename(item.filename);

        // AI : Delete based on deletion type
        if (item.deletionType === 'full' || item.deletionType === 'both') {
          try {
            await r2Storage.delete(item.filename);
            console.log(`Deleted full image: ${item.filename}`);
          } catch (error) {
            console.error(`Failed to delete full image ${item.filename}:`, error);
          }
        }

        if (item.deletionType === 'thumbnail' || item.deletionType === 'both') {
          try {
            await r2Storage.delete(thumbnailFilename);
            console.log(`Deleted thumbnail: ${thumbnailFilename}`);
          } catch (error) {
            console.error(`Failed to delete thumbnail ${thumbnailFilename}:`, error);
          }
        }

        // AI : Remove from scheduled_deletions table after successful deletion
        await db.delete(scheduledDeletions).where(eq(scheduledDeletions.id, item.id));
        deleted++;
      } catch (error) {
        console.error(`Failed to process deletion for ${item.filename}:`, error);
        failed++;
      }
    }

    console.log(`Cleanup complete: ${deleted} deleted, ${failed} failed`);
    return { deleted, failed };
  } catch (error) {
    console.error('Error executing pending deletions:', error);
    throw error;
  }
}

// AI : Delete local images immediately (for rejected/deleted pending overlays)
export async function deleteLocalImages(
  filename: string,
  deleteType: 'full' | 'thumbnail' | 'both'
): Promise<void> {
  const localStorage = new LocalFileStorage();
  const thumbnailFilename = getThumbnailFilename(filename);
  const failedFiles: string[] = [];

  try {
    // AI : Delete full image if requested
    if (deleteType === 'full' || deleteType === 'both') {
      try {
        await localStorage.delete(filename);
      } catch (error) {
        console.error(`Failed to delete local full image ${filename}:`, error);
        failedFiles.push(filename);
      }
    }

    // AI : Delete thumbnail if requested
    if (deleteType === 'thumbnail' || deleteType === 'both') {
      try {
        await localStorage.delete(thumbnailFilename);
      } catch (error) {
        console.error(`Failed to delete local thumbnail ${thumbnailFilename}:`, error);
        failedFiles.push(thumbnailFilename);
      }
    }

    // AI : Log failed deletions for manual cleanup (fallback strategy)
    if (failedFiles.length > 0) {
      const fs = await import('fs/promises');
      const logEntry = `${new Date().toISOString()} - Failed to delete: ${failedFiles.join(', ')}\n`;
      await fs.appendFile('./orphaned_files.txt', logEntry).catch(err => {
        console.error('Failed to write to orphaned files log:', err);
      });
    }
  } catch (error) {
    console.error('Error deleting local images:', error);
    throw error;
  }
}

// AI : Delete images immediately (handles both production/R2 and development/local)
export async function deleteImages(
  filename: string,
  deleteType: 'full' | 'thumbnail' | 'both'
): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const storage = isProduction ? new R2StorageS3({
    endpoint: process.env.R2_ENDPOINT!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!
  }) : new LocalFileStorage();

  const thumbnailFilename = getThumbnailFilename(filename);
  const failedFiles: string[] = [];

  try {
    // AI : Delete full image if requested
    if (deleteType === 'full' || deleteType === 'both') {
      try {
        await storage.delete(filename);
      } catch (error) {
        console.error(`Failed to delete full image ${filename}:`, error);
        failedFiles.push(filename);
      }
    }

    // AI : Delete thumbnail if requested
    if (deleteType === 'thumbnail' || deleteType === 'both') {
      try {
        await storage.delete(thumbnailFilename);
      } catch (error) {
        console.error(`Failed to delete thumbnail ${thumbnailFilename}:`, error);
        failedFiles.push(thumbnailFilename);
      }
    }

    // AI : Log failed deletions for manual cleanup
    if (failedFiles.length > 0 && !isProduction) {
      const fs = await import('fs/promises');
      const logEntry = `${new Date().toISOString()} - Failed to delete: ${failedFiles.join(', ')}\n`;
      await fs.appendFile('./orphaned_files.txt', logEntry).catch(err => {
        console.error('Failed to write to orphaned files log:', err);
      });
    }
  } catch (error) {
    console.error('Error deleting images:', error);
    throw error;
  }
}

// AI : Helper to calculate future date (e.g., 15 days from now)
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}
