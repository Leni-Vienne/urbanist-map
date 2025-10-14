import { StorageInterface } from './types';
import { S3Client } from 'bun';

// AI : Local filesystem storage implementation for development
export class LocalFileStorage implements StorageInterface {
    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        await Bun.write(`./uploads/${filename}`, buffer);
    }

    async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
        try {
            const file = Bun.file(`./uploads/${filename}`);
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
}
