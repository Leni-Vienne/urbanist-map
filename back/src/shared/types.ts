export interface StorageInterface {
    put(filename: string, buffer: ArrayBuffer): Promise<void>;
    get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
}

export interface AppConfig {
    corsOrigin: string | string[];
    jwtSecret: string;
    storage: StorageInterface;
    databaseUrl: string; // AI : Database URL for Workers context
    isProduction?: boolean; // AI : Flag to determine URL generation strategy
    r2PublicUrl?: string; // AI : R2 public URL for direct image access
}

// AI : JWT payload structure
export interface JWTPayload {
    userId: string;
    username?: string;
    iat?: number;
    exp?: number;
}

export interface FileUploadResult {
    success: boolean;
    filename: string;
    url: string;
}

export interface FileUploadError {
    error: string;
}
