import { generateThumbnail } from "./storage";
import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

// AI : Generate missing thumbnails on server startup
// AI : Thumbnails stay local until approval to prevent R2 cost abuse from spam uploads
// AI : After approval, they migrate to R2 along with the main image for public CDN delivery
export async function generateMissingThumbnails(): Promise<void> {
  console.log("Checking for missing thumbnails...");

  const uploadsDir = "./uploads";
  const thumbnailsDir = "./uploads/thumbnails";

  try {
    // AI : Ensure thumbnails directory exists
    await mkdir(thumbnailsDir, { recursive: true });

    // AI : Read all files in uploads directory (not recursive, excludes thumbnails folder)
    const files = await readdir(uploadsDir);

    // AI : Filter for image files only
    const imageFiles = files.filter((file) => {
      const isImage = /\.(webp|png|jpg|jpeg)$/i.test(file);
      return isImage;
    });

    let generatedCount = 0;
    let skippedCount = 0;

    for (const imageFile of imageFiles) {
      const thumbnailPath = join(thumbnailsDir, imageFile);

      // AI : Check if thumbnail already exists
      try {
        const thumbFile = Bun.file(thumbnailPath);
        const exists = await thumbFile.exists();

        if (exists) {
          skippedCount++;
          continue;
        }
      } catch {
        // AI : Thumbnail doesn't exist, continue to generate
      }

      // AI : Generate thumbnail directly without re-saving main image
      try {
        const imagePath = join(uploadsDir, imageFile);
        const imageFile_blob = Bun.file(imagePath);
        const buffer = await imageFile_blob.arrayBuffer();

        // AI : Generate and save thumbnail using centralized function
        const thumbnailBuffer = await generateThumbnail(buffer);
        await Bun.write(thumbnailPath, thumbnailBuffer);

        console.log(`Generated thumbnail for ${imageFile}`);
        generatedCount++;
      } catch (error) {
        console.error(`Failed to generate thumbnail for ${imageFile}:`, error);
      }
    }

    console.log(
      `Thumbnail generation complete: ${generatedCount} generated, ${skippedCount} already existed`,
    );
  } catch (error) {
    console.error("Error during thumbnail generation:", error);
  }
}
