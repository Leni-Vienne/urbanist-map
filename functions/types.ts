// AI : Cloudflare Types for Pages Functions
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

export {};
