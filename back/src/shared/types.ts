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

// AI : Shared type for overlay data sent to the frontend (used in cities.ts)
import type { DBProject, DBCity } from '../db/schema';

export interface CDNOverlayData {
    id: string;
    filename: string;
    caption: string | null;
    projectId: string | null;
    project: (DBProject & { city?: DBCity | null; }) | null;
    centroid: {
        lat: number;
        lng: number;
    };
    corners: { lat: number; lng: number }[];
    distance: number;
    createdAt: Date;
}

// AI : Shared type for detailed overlay queries (used in overlay.ts)
export interface OverlayWithDetails {
    id: string;
    topLeftLng: number;
    topLeftLat: number;
    topRightLng: number;
    topRightLat: number;
    bottomRightLng: number;
    bottomRightLat: number;
    bottomLeftLng: number;
    bottomLeftLat: number;
}
