// AI : Shared types used by both frontend and backend
import type { DBProject, DBCity, ApprovalStatus } from "../back/src/db/schema";
export type { ApprovalStatus } from "../back/src/db/schema";

// AI : Type for map viewing modes (used by both frontend and backend)
export type MapMode = "view" | "edit" | "moderation";

export interface OverlayData {
  id: string;
  version: number;
  filename: string;
  caption: string | null;
  // AI : Allow null for local overlays that haven't been submitted to backend yet
  status: ApprovalStatus | null;
  projectId: string | null;
  authorId: string | null;
  replacesOverlayId: string | null;
  replacedByOverlayId: string | null;
  createdAt: Date;
  updatedAt: Date;
  centroid: {
    lat: number;
    lng: number;
  };
  corners: { lat: number; lng: number }[];
  suggestedCorners?: { lat: number; lng: number }[];
  project?: (Omit<DBProject, "status"> & { status: ApprovalStatus | null; city: DBCity }) | null;
  distance?: number;
  isModified?: boolean;
  hasPendingChanges?: boolean;
  pendingChangeRequestsCount?: number;
}
