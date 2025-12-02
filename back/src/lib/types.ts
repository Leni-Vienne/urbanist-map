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

// AI : Shared type for overlay data sent to the frontend
import type { DBProject, DBCity } from '../db/schema';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'replaced';

export interface OverlayData {
    id: string;
    version: number;
    filename: string;
    caption: string | null;
    status: ApprovalStatus;
    projectId: string | null;
    authorId: string | null;
    replacesOverlayId: string | null;
    replacedByOverlayId: string | null; // AI : Reference to the overlay that replaced this one
    createdAt: Date;
    updatedAt: Date;
    centroid: {
        lat: number;
        lng: number;
    };
    corners: { lat: number; lng: number }[]; // AI : ALWAYS approved position from database (never changes meaning)
    suggestedCorners?: { lat: number; lng: number }[]; // AI : Suggested position if pending change requests exist
    project?: (Omit<DBProject, 'status'> & { status: ApprovalStatus | null; city: DBCity; }) | null;
    distance?: number;
    isModified?: boolean;
    hasPendingChanges?: boolean; // AI : True if user has pending change requests for this overlay
    pendingChangeRequestsCount?: number; // AI : Count of ALL pending change requests (moderation mode only)
}

