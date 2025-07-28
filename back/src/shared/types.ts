// AI : Shared types and interfaces for both local and Cloudflare Pages deployment

// AI : Cloudflare R2 Types (compatible with Workers Runtime)
declare global {
    interface R2Bucket {
        put(key: string, value: ArrayBuffer | ReadableStream | string): Promise<R2Object>;
        get(key: string): Promise<R2Object | null>;
        delete(key: string): Promise<void>;
    }

    interface R2Object {
        body: ReadableStream;
        httpMetadata?: {
            contentType?: string;
        };
    }
}

export interface StorageInterface {
    put(filename: string, buffer: ArrayBuffer): Promise<void>;
    get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
}

export interface AppConfig {
    corsOrigin: string | string[];
    sessionEncryptionKey: string;
    storage: StorageInterface;
    databaseUrl: string; // AI : Database URL for Workers context
}

export type SessionData = {
    userId?: string;
    isAuthenticated?: boolean;
    username?: string;
}

export interface FileUploadResult {
    success: boolean;
    filename: string;
    url: string;
}

export interface FileUploadError {
    error: string;
}
