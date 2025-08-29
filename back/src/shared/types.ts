export interface StorageInterface {
    put(filename: string, buffer: ArrayBuffer): Promise<void>;
    get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
}

export interface FileUploadResult {
    success: boolean;
    filename: string;
    url: string;
}

export interface FileUploadError {
    error: string;
}
