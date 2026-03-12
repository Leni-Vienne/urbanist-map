import type { StorageInterface } from "./types";
import { S3Client } from "bun";
import sharp from "sharp";
import { mkdir, unlink } from "node:fs/promises";

// Helper function to read ReadableStream into Uint8Array buffer
// Used when migrating files between storage backends or processing streams
export async function streamToBuffer(stream: ReadableStream): Promise<Uint8Array> {
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

// Centralized thumbnail generation function for consistency across storage implementations
// Generates 120x120 WebP thumbnail with cover fit (maintains aspect ratio, crops to fill)
// 120x120 chosen over 60x60 for better quality on high-DPI screens while staying small (~2-5KB)
export async function generateThumbnail(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const thumbnailBuffer = await sharp(Buffer.from(buffer))
    .resize(120, 120, {
      fit: "cover",
      position: "center",
    })
    .webp()
    .toBuffer();

  return thumbnailBuffer.buffer as ArrayBuffer;
}

interface CompressionResult {
  buffer: ArrayBuffer;
  extension: string;
  wasCompressed: boolean;
  originalSize: number;
  finalSize: number;
}

export async function compressImageIfNeeded(
  buffer: ArrayBuffer,
  originalExtension: string,
): Promise<CompressionResult> {
  const originalSize = buffer.byteLength;
  const ext = originalExtension.toLowerCase();

  try {
    // Convert to lossy WebP at quality 90 (high quality to minimize artifacts from re-encoding)
    // This also handles lossless WebP → lossy WebP conversion for size savings
    const webpBuffer = await sharp(Buffer.from(buffer)).webp({ quality: 90 }).toBuffer();

    const webpSize = webpBuffer.byteLength;

    // Only use WebP if it's actually smaller (prevents quality loss with no size benefit)
    if (webpSize < originalSize) {
      return {
        buffer: webpBuffer.buffer as ArrayBuffer,
        extension: "webp",
        wasCompressed: true,
        originalSize,
        finalSize: webpSize,
      };
    }

    // Compressed version was larger - keep original format
    return {
      buffer,
      extension: ext,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  } catch (error) {
    // If compression fails, return original unchanged
    console.error("Image compression failed, keeping original:", error);
    return {
      buffer,
      extension: ext,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }
}

// Local filesystem storage implementation for development
export class LocalFileStorage implements StorageInterface {
  async put(
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ): Promise<void> {
    await Bun.write(`./uploads/${filename}`, buffer);

    // Skip thumbnail generation if explicitly requested (when uploading thumbnails themselves)
    if (options?.skipThumbnail) {
      return;
    }

    // Generate thumbnail for image files
    // Thumbnails stored in ./uploads/thumbnails/ for better organization
    // Not stored in DB, derived from filename
    // Two-phase strategy: Stays local during moderation (prevent R2 abuse), migrates to R2 on approval
    try {
      // Ensure thumbnails directory exists
      await mkdir("./uploads/thumbnails", { recursive: true });

      const thumbnailBuffer = await generateThumbnail(buffer);
      const thumbnailPath = `./uploads/thumbnails/${filename}`;
      await Bun.write(thumbnailPath, thumbnailBuffer);

      // Verify thumbnail file exists and is readable before returning
      // Prevents race condition where frontend tries to load thumbnail before it's fully available
      const thumbnailFile = Bun.file(thumbnailPath);
      const exists = await thumbnailFile.exists();
      if (!exists) {
        throw new Error(`Thumbnail file was written but is not accessible: ${thumbnailPath}`);
      }
    } catch (error) {
      // Re-throw thumbnail errors to prevent returning success when thumbnail creation fails
      // This ensures frontend won't try to display a non-existent thumbnail
      console.error(`Failed to generate thumbnail for ${filename}:`, error);
      throw error;
    }
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      // File path already includes full path from request (e.g., "thumbnails/image.webp" or "image.webp")
      const filePath = `./uploads/${filename}`;

      const file = Bun.file(filePath);
      const exists = await file.exists();

      if (!exists) {
        return null;
      }

      return {
        body: file.stream(),
        contentType: file.type ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  // Delete a single file - does NOT automatically delete related thumbnails
  // Callers are responsible for deciding what files to delete (see deleteLocalImages in imageCleanup.ts)
  async delete(filename: string): Promise<void> {
    try {
      await unlink(`./uploads/${filename}`);
    } catch (error) {
      // Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename}:`, error);
    }
  }
}

// Cloudflare R2 storage implementation using Bun's built-in S3 client
// Used for production when backend runs on dedicated server
export class R2StorageS3 implements StorageInterface {
  private readonly client: S3Client;

  constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }) {
    // Create S3 client using Bun's S3Client API
    this.client = new S3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucketName,
      endpoint: config.endpoint,
    });
  }

  async put(
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ): Promise<void> {
    // Get lazy reference to S3 file
    const s3file = this.client.file(filename);

    // Upload to R2 using write method
    await s3file.write(buffer, {
      type: "image/webp",
    });

    // Skip thumbnail generation if explicitly requested (when uploading thumbnails themselves)
    if (options?.skipThumbnail) {
      return;
    }

    // Generate and upload thumbnail for image files (same strategy as LocalFileStorage for consistency)
    try {
      const thumbnailBuffer = await generateThumbnail(buffer);

      // Upload thumbnail with thumbnails/ prefix
      const thumbnailFilename = getThumbnailFilename(filename);
      const thumbnailS3file = this.client.file(thumbnailFilename);
      await thumbnailS3file.write(thumbnailBuffer, {
        type: "image/webp",
      });
    } catch (error) {
      // Re-throw thumbnail errors to prevent returning success when thumbnail creation fails
      // This ensures frontend won't try to display a non-existent thumbnail
      console.error(`Failed to generate thumbnail for ${filename}:`, error);
      throw error;
    }
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      // Get lazy reference to S3 file
      const s3file = this.client.file(filename);

      // S3File extends Blob and lazily fetches on first access
      // If file doesn't exist, accessing properties will throw
      return {
        body: s3file.stream(),
        contentType: s3file.type ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  // Delete a single file - does NOT automatically delete related thumbnails
  // Callers are responsible for deciding what files to delete (see deleteImages in imageCleanup.ts)
  async delete(filename: string): Promise<void> {
    try {
      await this.client.delete(filename);
    } catch (error) {
      // Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename} from R2:`, error);
    }
  }
}

// Helper function to derive thumbnail path from original filename
// Thumbnails stored in separate folder for better organization
// Used to request thumbnails without storing in DB (e.g., image.webp -> thumbnails/image.webp)
export function getThumbnailFilename(filename: string): string {
  return `thumbnails/${filename}`;
}
