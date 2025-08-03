import { StorageInterface } from './types';

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
                contentType: file.type || 'application/octet-stream'
            };
        } catch {
            return null;
        }
    }
}

// AI : Cloudflare R2 storage implementation for production
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
