import type { StorageInterface } from "./types";
import { S3Client } from "bun";
import { mkdir, unlink } from "node:fs/promises";

// Helper function to read ReadableStream into Uint8Array buffer
// Used when migrating files between storage backends or processing streams
export async function streamToBuffer(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  // eslint-disable-next-line no-unnecessary-condition
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

// Copies a Uint8Array into a fresh ArrayBuffer of exactly the right size.
// Avoids exposing the source buffer (which may be a pool slice or SharedArrayBuffer).
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

// Generates a WebP thumbnail bounded to 120x120 (aspect ratio preserved).
// Square framing is applied client-side via CSS object-cover on a square container.
export async function generateThumbnail(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const bytes = await new Bun.Image(buffer).resize(120, 120, { fit: "inside" }).webp().bytes();
    return toArrayBuffer(bytes);
  } catch (error) {
    console.error("Thumbnail generation failed:", error);
    throw error;
  }
}

interface CompressionResult {
  buffer: ArrayBuffer;
  extension: string;
  wasCompressed: boolean;
  originalSize: number;
  finalSize: number;
}

const MAX_DIMENSION_PX = 4096;

export async function compressImageIfNeeded(
  buffer: ArrayBuffer,
  originalExtension: string,
): Promise<CompressionResult> {
  const originalSize = buffer.byteLength;
  const ext = originalExtension.toLowerCase();

  try {
    // Format is sniffed from the bytes, so a wrong extension (e.g. a PNG named
    // .webp) is decoded transparently without any mismatch error.
    const { width, height } = await new Bun.Image(buffer).metadata();
    const oversized = width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX;

    // A Bun.Image pipeline is consumed by its terminal op, so each encode
    // starts from a fresh decode bounded to the dimension cap. Lossy uses a
    // smooth resampler (best for photos); lossless uses nearest, which keeps the
    // flat colour palette that makes lossless WebP small on graphics / line-art
    // (smooth resamplers add gradients that bloat the lossless stream).
    function base(filter: "lanczos3" | "nearest") {
      const image = new Bun.Image(buffer);
      return oversized
        ? image.resize(MAX_DIMENSION_PX, MAX_DIMENSION_PX, { fit: "inside", filter })
        : image;
    }

    // Race lossy against lossless WebP: lossy wins on photos, while lossless
    // often beats the source on flat-colour / line-art graphics.
    const [lossy, lossless] = await Promise.all([
      base("lanczos3").webp({ quality: 90 }).bytes(),
      base("nearest").webp({ lossless: true }).bytes(),
    ]);
    const bestWebp = lossless.byteLength <= lossy.byteLength ? lossless : lossy;

    // Keep the source only when it is within the cap and nothing beats it on
    // size. An oversized source must be re-encoded to enforce the dimension cap
    // (large textures render black on GPUs whose max texture size is 4096).
    const keepOriginal = !oversized && originalSize <= bestWebp.byteLength;

    let chosenType = "lossy-webp";
    if (keepOriginal) chosenType = "original";
    else if (bestWebp === lossless) chosenType = "lossless-webp";

    console.log(
      `[compressImage] ${width}x${height}${oversized ? ` -> cap ${MAX_DIMENSION_PX}` : ""} | ` +
        `original ${(originalSize / 1024).toFixed(1)}KB lossy ${(lossy.byteLength / 1024).toFixed(1)}KB lossless ${(lossless.byteLength / 1024).toFixed(1)}KB | ` +
        `chose ${chosenType}`,
    );

    if (keepOriginal) {
      return {
        buffer,
        extension: ext,
        wasCompressed: false,
        originalSize,
        finalSize: originalSize,
      };
    }

    return {
      buffer: toArrayBuffer(bestWebp),
      extension: "webp",
      wasCompressed: true,
      originalSize,
      finalSize: bestWebp.byteLength,
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

// Local filesystem storage implementation for development.
/* oxlint-disable class-methods-use-this */
export class LocalFileStorage implements StorageInterface {
  public async put(
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ): Promise<void> {
    await Bun.write(`./uploads/${filename}`, buffer);

    // Skip thumbnail generation if explicitly requested (when uploading thumbnails themselves)
    if (options?.skipThumbnail) {
      return;
    }

    try {
      await mkdir("./uploads/thumbnails", { recursive: true });

      const thumbnailBuffer = await generateThumbnail(buffer);
      const thumbnailPath = `./uploads/thumbnails/${filename}`;
      await Bun.write(thumbnailPath, thumbnailBuffer);
    } catch (error) {
      // Re-throw thumbnail errors to prevent returning success when thumbnail creation fails
      // This ensures frontend won't try to display a non-existent thumbnail
      console.error(`Failed to generate thumbnail for ${filename}:`, error);
      throw error;
    }
  }

  // Persists the pre-compression original locally under uploads/originals/.
  // Originals are never migrated to R2 and never get a thumbnail; they are a
  // full-quality, uncapped archival copy kept only while the overlay is approved.
  public async putOriginal(filename: string, buffer: ArrayBuffer): Promise<void> {
    await mkdir("./uploads/originals", { recursive: true });
    await Bun.write(`./uploads/originals/${filename}`, buffer);
  }

  public async get(
    filename: string,
  ): Promise<{ body: ReadableStream; contentType?: string } | null> {
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
        contentType: file.type || "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  // Delete a single file - does NOT automatically delete related thumbnails
  // Callers are responsible for deciding what files to delete (see deleteLocalImages in imageCleanup.ts)
  public async delete(filename: string): Promise<void> {
    try {
      await unlink(`./uploads/${filename}`);
    } catch (error) {
      // Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename}:`, error);
    }
  }
}
/* oxlint-enable class-methods-use-this */

// Cloudflare R2 storage implementation using Bun's built-in S3 client
// Used for production when backend runs on dedicated server
export class R2StorageS3 implements StorageInterface {
  private readonly client: S3Client;

  public constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }) {
    this.client = new S3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket: config.bucketName,
      endpoint: config.endpoint,
    });
  }

  public async put(
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ): Promise<void> {
    const s3file = this.client.file(filename);
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

  public async get(
    filename: string,
  ): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      const s3file = this.client.file(filename);
      return {
        body: s3file.stream(),
        contentType: s3file.type || "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  // Delete a single file - does NOT automatically delete related thumbnails
  // Callers are responsible for deciding what files to delete (see deleteImages in imageCleanup.ts)
  public async delete(filename: string): Promise<void> {
    try {
      await this.client.delete(filename);
    } catch (error) {
      // Log but don't throw - file might already be deleted
      console.warn(`Failed to delete file ${filename} from R2:`, error);
    }
  }
}

export function getThumbnailFilename(filename: string): string {
  return `thumbnails/${filename}`;
}
