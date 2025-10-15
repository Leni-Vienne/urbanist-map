import { db } from '../database';
import { overlays } from '../db/schema';
import { eq } from 'drizzle-orm';
import { R2StorageS3, getThumbnailFilename } from '../shared/storage';
import sharp from 'sharp';

// AI : Helper function to read stream into buffer
async function streamToBuffer(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  
  return buffer;
}

// AI : Generate and upload thumbnails for existing approved overlays in R2
// This is a one-time migration script for overlays that were approved before thumbnail feature
// Only processes approved overlays since those are in R2 (pending ones stay local)
async function generateR2Thumbnails() {
  console.log('Starting R2 thumbnail generation for existing approved overlays...');
  
  // AI : Initialize R2 storage
  const r2Storage = new R2StorageS3({
    endpoint: process.env.R2_ENDPOINT!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!
  });
  
  // AI : Query all approved overlays (these are in R2, not local)
  const approvedOverlays = await db
    .select({ id: overlays.id, filename: overlays.filename })
    .from(overlays)
    .where(eq(overlays.status, 'approved'));
  
  console.log(`Found ${approvedOverlays.length} approved overlays`);
  
  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  for (const overlay of approvedOverlays) {
    try {
      const thumbnailFilename = getThumbnailFilename(overlay.filename);
      
      console.log(`Checking for thumbnail: ${thumbnailFilename}`);
      
      // AI : Check if thumbnail already exists in R2
      const existingThumbnail = await r2Storage.get(thumbnailFilename);
      if (existingThumbnail) {
        // AI : Try to read the size to ensure it's a real file, not an empty folder marker
        try {
          const buffer = await streamToBuffer(existingThumbnail.body);
          if (buffer.length > 0) {
            console.log(`Valid thumbnail already exists for ${overlay.filename} (${buffer.length} bytes), skipping`);
            skippedCount++;
            continue;
          }
        } catch {
          console.log(`Found invalid thumbnail for ${overlay.filename}, will regenerate`);
        }
      }
      
      console.log(`Thumbnail not found, generating for ${overlay.filename}`);
      
      // AI : Download original image from R2
      const originalImage = await r2Storage.get(overlay.filename);
      if (!originalImage) {
        console.error(`Original image not found in R2: ${overlay.filename}`);
        errorCount++;
        continue;
      }
      
      // AI : Read image into buffer
      const imageBuffer = await streamToBuffer(originalImage.body);
      
      // AI : Generate 120x120 thumbnail using sharp
      const thumbnailBuffer = await sharp(Buffer.from(imageBuffer))
        .resize(120, 120, {
          fit: 'cover',
          position: 'center'
        })
        .webp()
        .toBuffer();
      
      // AI : Upload thumbnail to R2 with skipThumbnail option to prevent recursive thumbnail generation
      await r2Storage.put(thumbnailFilename, thumbnailBuffer.buffer as ArrayBuffer, { skipThumbnail: true });
      
      console.log(`Generated and uploaded thumbnail for ${overlay.filename}`);
      processedCount++;
      
      // AI : Add small delay to avoid overwhelming R2 (optional, adjust as needed)
      await Bun.sleep(100);
      
    } catch (error) {
      console.error(`Failed to process ${overlay.filename}:`, error);
      errorCount++;
    }
  }
  
  console.log('\n=== R2 Thumbnail Generation Complete ===');
  console.log(`Processed: ${processedCount}`);
  console.log(`Skipped (already exists): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total overlays: ${approvedOverlays.length}`);
}

// AI : Run the script
generateR2Thumbnails()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
