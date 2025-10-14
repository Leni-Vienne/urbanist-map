import { StorageInterface } from './types';
import { S3Client } from 'bun';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

// AI : Local filesystem storage implementation for development
export class LocalFileStorage implements StorageInterface {
    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        await Bun.write(`./uploads/${filename}`, buffer);
        
        // AI : Generate 120x120 thumbnail for image files using sharp
        // 120x120 chosen over 60x60 for better quality on high-DPI screens while staying small (~2-5KB)
        // Thumbnails stored in ./uploads/thumbnails/ for better organization
        // Not stored in DB, derived from filename
        // Two-phase strategy: Stays local during moderation (prevent R2 abuse), migrates to R2 on approval
        try {
            // AI : Ensure thumbnails directory exists
            await mkdir('./uploads/thumbnails', { recursive: true });
            
            // AI : Use sharp to resize image to 120x120 with cover fit (maintains aspect ratio, crops to fill)
            await sharp(Buffer.from(buffer))
                .resize(120, 120, {
                    fit: 'cover',
                    position: 'center'
                })
                .webp({ quality: 80 })
                .toFile(`./uploads/thumbnails/${filename}`);
        } catch (error) {
            // AI : Log thumbnail generation errors but don't fail the main upload
            console.warn(`Failed to generate thumbnail for ${filename}:`, error);
        }
    }

    async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
        try {
            // AI : Check if requesting a thumbnail (check thumbnails folder first)
            const isThumbnailRequest = filename.includes('/thumbnails/');
            const filePath = isThumbnailRequest ? `./uploads/${filename}` : `./uploads/${filename}`;
            
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

    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        // AI : Get lazy reference to S3 file
        const s3file = this.client.file(filename);
        
        // AI : Upload to R2 using write method
        await s3file.write(buffer, {
            type: 'image/webp',
        });
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
