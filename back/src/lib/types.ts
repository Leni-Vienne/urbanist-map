// Backend-specific types (storage, file upload)
// For shared types (ApprovalStatus, AppMode), see @shared/types

import type { AuthUser } from "@shared/types/auth";

export type SessionUser = AuthUser;

// Hono environment shared by the main app and its mounted sub-apps.
export type AppEnv = {
  Variables: {
    user?: SessionUser;
  };
};

export interface StorageInterface {
  put: (
    filename: string,
    buffer: ArrayBuffer,
    options?: { skipThumbnail?: boolean },
  ) => Promise<void>;
  get: (filename: string) => Promise<{ body: ReadableStream; contentType?: string } | null>;
  delete: (filename: string) => Promise<void>;
}

export interface FileUploadResult {
  success: boolean;
  filename: string;
  url: string;
  thumbnailUrl: string;
}
