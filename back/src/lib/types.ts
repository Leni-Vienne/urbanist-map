// AI : Backend-specific types (storage, file upload)
// AI : For shared types (ApprovalStatus, OverlayData, FieldChange), see @shared/types

export interface StorageInterface {
    put(filename: string, buffer: ArrayBuffer, options?: { skipThumbnail?: boolean }): Promise<void>;
    get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
    delete(filename: string): Promise<void>;
}

export interface FileUploadResult {
    success: boolean;
    filename: string;
    url: string;
    thumbnailUrl: string;
}

export interface FileUploadError {
    error: string;
}

// AI : Re-export shared types for convenience
export type { ApprovalStatus, OverlayData, FieldChange, SubmitChangeRequestInput } from '@shared/types';
