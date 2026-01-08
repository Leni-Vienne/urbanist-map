import type { StorageInterface } from "./types";
import { S3Client } from "bun";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// AI : Helper function to read ReadableStream into Uint8Array buffer
// AI : Used when migrating files between storage backends or processing streams
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

// AI : Centralized thumbnail generation function for consistency across storage implementations
// AI : Generates 120x120 WebP thumbnail with cover fit (maintains aspect ratio, crops to fill)
// AI : 120x120 chosen over 60x60 for better quality on high-DPI screens while staying small (~2-5KB)
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

// AI : Smart image compression result type
export interface CompressionResult {
  buffer: ArrayBuffer;
  extension: string;
  wasCompressed: boolean;
  originalSize: number;
  finalSize: number;
}

// AI : Smart image compression function
// AI : Converts to WebP at quality 90 to minimize generation loss on already-compressed images
// AI : If WebP result is larger than original (e.g., well-optimized JPEG), keeps original
// AI : This prevents double-compression artifacts while still capturing easy wins on unoptimized uploads
// AI : Also compresses WebP files since lossless WebP can be quite large
export async function compressImage(
  buffer: ArrayBuffer,
  originalExtension: string,
): Promise<CompressionResult> {
  const originalSize = buffer.byteLength;
  const ext = originalExtension.toLowerCase();

  try {
    // AI : Convert to lossy WebP at quality 90 (high quality to minimize artifacts from re-encoding)
    // AI : This also handles lossless WebP → lossy WebP conversion for size savings
    const webpBuffer = await sharp(Buffer.from(buffer)).webp({ quality: 90 }).toBuffer();

    const webpSize = webpBuffer.byteLength;

    // AI : Only use WebP if it's actually smaller (prevents quality loss with no size benefit)
    if (webpSize < originalSize) {
      return {
        buffer: webpBuffer.buffer as ArrayBuffer,
        extension: "webp",
        wasCompressed: true,
        originalSize,
        finalSize: webpSize,
      };
    }

    // AI : Compressed version was larger - keep original format
    return {
      buffer,
      extension: ext,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  } catch (error) {
    // AI : If compression fails, return original unchanged
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

// AI : Local filesystem storage implementation for development
export class LocalFileStorage implements StorageInterface {
  async put(
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ): Promise<void> {
    await Bun.write(`./uploads/${filename}`, buffer);

    // AI : Skip thumbnail generation if explicitly requested (when uploading thumbnails themselves)
    if (options?.skipThumbnail) {
      return;
    }

    // AI : Generate thumbnail for image files
    // AI : Thumbnails stored in ./uploads/thumbnails/ for better organization
    // AI : Not stored in DB, derived from filename
    // AI : Two-phase strategy: Stays local during moderation (prevent R2 abuse), migrates to R2 on approval
    try {
      // AI : Ensure thumbnails directory exists
      await mkdir("./uploads/thumbnails", { recursive: true });

      const thumbnailBuffer = await generateThumbnail(buffer);
      const thumbnailPath = `./uploads/thumbnails/${filename}`;
      await Bun.write(thumbnailPath, thumbnailBuffer);

      // AI : Verify thumbnail file exists and is readable before returning
      // AI : Prevents race condition where frontend tries to load thumbnail before it's fully available
      const thumbnailFile = Bun.file(thumbnailPath);
      const exists = await thumbnailFile.exists();
      if (!exists) {
        throw new Error(`Thumbnail file was written but is not accessible: ${thumbnailPath}`);
      }
    } catch (error) {
      // AI : Re-throw thumbnail errors to prevent returning success when thumbnail creation fails
      // AI : This ensures frontend won't try to display a non-existent thumbnail
      console.error(`Failed to generate thumbnail for ${filename}:`, error);
      throw error;
    }
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      // AI : File path already includes full path from request (e.g., "thumbnails/image.webp" or "image.webp")
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

  // AI : Delete a single file - does NOT automatically delete related thumbnails
  // AI : Callers are responsible for deciding what files to delete (see deleteLocalImages in imageCleanup.ts)
  async delete(filename: string): Promise<void> {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(`./uploads/${filename}`);
    } catch (error) {
      // AI : Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename}:`, error);
    }
  }
}

// AI : Cloudflare R2 storage implementation using Bun's built-in S3 client
// AI : Used for production when backend runs on dedicated server
export class R2StorageS3 implements StorageInterface {
  private client: S3Client;

  constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }) {
    // AI : Create S3 client using Bun's S3Client API
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
    // AI : Get lazy reference to S3 file
    const s3file = this.client.file(filename);

    // AI : Upload to R2 using write method
    await s3file.write(buffer, {
      type: "image/webp",
    });

    // AI : Skip thumbnail generation if explicitly requested (when uploading thumbnails themselves)
    if (options?.skipThumbnail) {
      return;
    }

    // AI : Generate and upload thumbnail for image files (same strategy as LocalFileStorage for consistency)
    try {
      const thumbnailBuffer = await generateThumbnail(buffer);

      // AI : Upload thumbnail with thumbnails/ prefix
      const thumbnailFilename = getThumbnailFilename(filename);
      const thumbnailS3file = this.client.file(thumbnailFilename);
      await thumbnailS3file.write(thumbnailBuffer, {
        type: "image/webp",
      });
    } catch (error) {
      // AI : Re-throw thumbnail errors to prevent returning success when thumbnail creation fails
      // AI : This ensures frontend won't try to display a non-existent thumbnail
      console.error(`Failed to generate thumbnail for ${filename}:`, error);
      throw error;
    }
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      // AI : Get lazy reference to S3 file
      const s3file = this.client.file(filename);

      // AI : S3File extends Blob and lazily fetches on first access
      // AI : If file doesn't exist, accessing properties will throw
      return {
        body: s3file.stream(),
        contentType: s3file.type ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  // AI : Delete a single file - does NOT automatically delete related thumbnails
  // AI : Callers are responsible for deciding what files to delete (see deleteImages in imageCleanup.ts)
  async delete(filename: string): Promise<void> {
    try {
      await this.client.delete(filename);
    } catch (error) {
      // AI : Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename} from R2:`, error);
    }
  }
}

// AI : Helper function to derive thumbnail path from original filename
// Thumbnails stored in separate folder for better organization
// Used to request thumbnails without storing in DB (e.g., image.webp -> thumbnails/image.webp)
export function getThumbnailFilename(filename: string): string {
  return `thumbnails/${filename}`;
}
