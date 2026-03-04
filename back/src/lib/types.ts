// Backend-specific types (storage, file upload)
// For shared types (ApprovalStatus, OverlayData), see @shared/types
// For change request types (FieldChange, SubmitChangeRequestInput), see @shared/validation/schemas

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
