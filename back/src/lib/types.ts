// Backend-specific types (storage, file upload)
// For shared types (ApprovalStatus, AppMode), see @shared/types
// For change request types (FieldChange, SubmitChangeRequestInput), see @shared/validation/schemas

import type { Session } from "hono-sessions";

export type SessionUser = {
  id: string;
  email: string;
  username: string | null;
  role: string | null;
  moderatedCountries: string[] | null;
  emailVerified: boolean;
};

type SessionData = {
  user?: SessionUser;
  expiresAt?: string;
  // Transient CSRF state for the OSM OAuth redirect, set on /api/osm-login and
  // consumed (single-use) on /api/osm-callback.
  osmOauth?: { state: string; rememberMe: boolean };
};

// Hono environment shared by the main app and its mounted sub-apps.
export type AppEnv = {
  Variables: {
    session: Session<SessionData>;
  };
};

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
