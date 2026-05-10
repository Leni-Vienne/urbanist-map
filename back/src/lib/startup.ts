import { generateThumbnail } from "./storage";
import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

// Generate missing thumbnails on server startup
// Thumbnails stay local until approval to prevent R2 cost abuse from spam uploads
// After approval, they migrate to R2 along with the main image for public CDN delivery
export async function generateMissingThumbnails(): Promise<void> {
  console.log("Checking for missing thumbnails...");

  const uploadsDir = "./uploads";
  const thumbnailsDir = "./uploads/thumbnails";

  try {
    await mkdir(thumbnailsDir, { recursive: true });

    const files = await readdir(uploadsDir);

    const imageFiles = files.filter((file) => {
      const isImage = /\.(webp|png|jpg|jpeg)$/i.test(file);
      return isImage;
    });

    let generatedCount = 0;
    let skippedCount = 0;

    for (const imageFile of imageFiles) {
      const thumbnailPath = join(thumbnailsDir, imageFile);

      try {
        const thumbFile = Bun.file(thumbnailPath);
        const exists = await thumbFile.exists();

        if (exists) {
          skippedCount += 1;
          continue;
        }
      } catch {
        // Thumbnail doesn't exist, continue to generate
      }

      // Generate thumbnail directly without re-saving main image
      try {
        const imagePath = join(uploadsDir, imageFile);
        const imageFileBlob = Bun.file(imagePath);
        const buffer = await imageFileBlob.arrayBuffer();

        // Generate and save thumbnail using centralized function
        const thumbnailBuffer = await generateThumbnail(buffer);
        await Bun.write(thumbnailPath, thumbnailBuffer);

        console.log(`Generated thumbnail for ${imageFile}`);
        generatedCount += 1;
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
