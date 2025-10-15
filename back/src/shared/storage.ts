import { StorageInterface } from './types';
import { S3Client } from 'bun';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

// AI : Centralized thumbnail generation function for consistency across storage implementations
// AI : Generates 120x120 WebP thumbnail with cover fit (maintains aspect ratio, crops to fill)
// AI : 120x120 chosen over 60x60 for better quality on high-DPI screens while staying small (~2-5KB)
export async function generateThumbnail(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const thumbnailBuffer = await sharp(Buffer.from(buffer))
        .resize(120, 120, {
            fit: 'cover',
            position: 'center'
        })
        .webp()
        .toBuffer();
    
    return thumbnailBuffer.buffer as ArrayBuffer;
}

// AI : Local filesystem storage implementation for development
export class LocalFileStorage implements StorageInterface {
    async put(filename: string, buffer: ArrayBuffer, options?: { skipThumbnail?: boolean }): Promise<void> {
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
            await mkdir('./uploads/thumbnails', { recursive: true });
            
            const thumbnailBuffer = await generateThumbnail(buffer);
            await Bun.write(`./uploads/thumbnails/${filename}`, thumbnailBuffer);
        } catch (error) {
            // AI : Log thumbnail generation errors but don't fail the main upload
            console.warn(`Failed to generate thumbnail for ${filename}:`, error);
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
                contentType: file.type ?? 'application/octet-stream'
            };
        } catch {
            return null;
        }
    }

    async delete(filename: string): Promise<void> {
        try {
            const { unlink } = await import('node:fs/promises');
            await unlink(`./uploads/${filename}`);
            
            // AI : Also delete thumbnail if it exists
            const thumbnailPath = `./uploads/thumbnails/${filename}`;
            try {
                await unlink(thumbnailPath);
            } catch (error) {
                // AI : Thumbnail might not exist, don't fail main deletion
                console.warn(`Failed to delete thumbnail ${thumbnailPath}:`, error);
            }
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

    async put(filename: string, buffer: ArrayBuffer, options?: { skipThumbnail?: boolean }): Promise<void> {
        // AI : Get lazy reference to S3 file
        const s3file = this.client.file(filename);
        
        // AI : Upload to R2 using write method
        await s3file.write(buffer, {
            type: 'image/webp',
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
                type: 'image/webp',
            });
        } catch (error) {
            // AI : Log thumbnail generation errors but don't fail the main upload
            console.warn(`Failed to generate thumbnail for ${filename}:`, error);
        }
    }

    async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
        try {
            // AI : Get lazy reference to S3 file
            const s3file = this.client.file(filename);
            
            // AI : Check if file exists by attempting to get size
            // AI : S3File extends Blob, so we can check if it's accessible
            try {
                await s3file.size;
            } catch {
                return null;
            }

            return {
                body: s3file.stream(),
                contentType: s3file.type ?? 'application/octet-stream'
            };
        } catch {
            return null;
        }
    }

    async delete(filename: string): Promise<void> {
        try {
            await this.client.delete(filename);
            
            // AI : Also delete thumbnail if it exists
            const thumbnailFilename = getThumbnailFilename(filename);
            try {
                await this.client.delete(thumbnailFilename);
            } catch (error) {
                // AI : Thumbnail might not exist, don't fail main deletion
                console.warn(`Failed to delete thumbnail ${thumbnailFilename} from R2:`, error);
            }
        } catch (error) {
            // AI : Log but don't throw - file might already be deleted
            console.warn(`Failed to delete file ${filename} from R2:`, error);
        }
    }
}

// AI : Cloudflare R2 storage implementation for Cloudflare Workers runtime
// AI : Only works when running inside Cloudflare Workers with R2 bindings
export class R2Storage implements StorageInterface {
    constructor(private bucket: R2Bucket) {}

    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        await this.bucket.put(filename, buffer);
    }

    async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
        try {
            const object = await this.bucket.get(filename);
            if (!object) {
                return null;
            }
            
            return {
                body: object.body,
                contentType: object.httpMetadata?.contentType
            };
        } catch {
            return null;
        }
    }

    async delete(filename: string): Promise<void> {
        try {
            await this.bucket.delete(filename);
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
