import type { RouterOutput } from "@/client";
import type {
  DBProject,
  DBCity,
  DBImportSource,
  ApprovalStatus,
} from "../../../back/src/db/schema";

// Type definitions for field modifications in submission dialogs
export type ModifiableField = "caption" | "corners";
export type RemovableChange = ModifiableField | "new_overlay" | "geometry";

// Type for marker colors used throughout the application
export type MarkerColor = "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "grey";

// Interface for camera bounds used in view mode
export interface CameraBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}

export type PendingChangeRequest =
  RouterOutput["moderation"]["getPendingSubmissions"]["changeRequests"][0];

export type LatestContribution = RouterOutput["feed"]["getLatestContributions"][number];

// Base runtime project type - extends DB schema with computed fields
export interface Project extends Omit<DBProject, "status" | "tags"> {
  // Override status to allow null for local unsubmitted projects
  status: ApprovalStatus | null;
  // Computed fields for all contexts
  city: DBCity | null;
  overlayIds: string[];
  // Always an array on the frontend, null coerced to [] at DB boundary
  tags: string[];
  // Joined import source details (null for user-created projects)
  importSource?: DBImportSource | null;
  // UI state for tracking local modifications
  isModified?: boolean;

  // Denormalized location names, populated by location-aware queries (joins).
  cityName?: string | null;
  countryName?: string | null;

  // Owner display + spam-detection fields, populated by moderation/contribution endpoints.
  ownerUsername?: string | null;
  ownerApprovedCount?: number | null;
  ownerRejectedCount?: number | null;
  ownerReportCount?: number;

  // Cached overlay count for list views that don't hydrate the full overlays array.
  overlayCount?: number;
}

export interface ProjectFormData {
  name: string;
  description: string | null;
  proposalDate: Date | null;
  proposalDatePrecision: "year" | "month" | "day" | null;
  startDate: Date | null;
  startDatePrecision: "year" | "month" | "day" | null;
  endDate: Date | null;
  endDatePrecision: "year" | "month" | "day" | null;
  cityId: number | null;
  countryCode: string | null;
  sourceUrl: string | null;
  tags: string[];
  timelineStatus: "proposed" | "planned" | "under_construction" | "completed" | "canceled";
}

// Wire format from backend API - derived automatically from tRPC route output
type ApiOverlayData = RouterOutput["viewport"]["getOverlaysInViewport"][number];

// Frontend overlay data type - extends API type with:
// - null status for local overlays not yet submitted to the backend
// - nullable project for local overlays constructed without a project join
// - optional fields that are absent on locally-constructed overlays
// - isModified for UI tracking of user-moved overlays in the current session
export type OverlayData = Omit<
  ApiOverlayData,
  | "status"
  | "project"
  | "distance"
  | "suggestedCorners"
  | "hasPendingChanges"
  | "pendingChangeRequestsCount"
> & {
  status: ApprovalStatus | null;
  project?: ApiOverlayData["project"] | Project | null;
  distance?: number;
  suggestedCorners?: { lat: number; lng: number }[];
  hasPendingChanges?: boolean;
  pendingChangeRequestsCount?: number;
  isModified?: boolean;
};

// Frontend overlay type - extends OverlayData with editor state
// Map layer references (image overlay + marker) live in overlayRenderRegistry,
// not on this type. OverlayObject is pure domain data.
// A normalized sub-rectangle of an image, u left->right, v top->bottom, each in [0, 1].
export interface NormalizedRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

// One step in an overlay's edit history. Carries both the footprint corners and the image they
// belong to, so undo/redo restores the right pixels for a step (a crop changes the image, a
// move/resize reuses the same imageUrl string by reference, so position steps cost no extra memory).
// cropRect is the region of history[0].imageUrl (the pristine original) that this step's image
// shows; absent means the full original. It lets each crop re-bake from the original instead of
// the previous crop, so repeated crops stay a single compression generation from the source.
export interface OverlayHistoryState {
  corners: { lat: number; lng: number }[];
  imageUrl: string;
  cropRect?: NormalizedRect;
}

export interface OverlayObject extends OverlayData {
  // Computed fields
  imageUrl: string;

  // Editor state
  history: OverlayHistoryState[];
  redoStack: OverlayHistoryState[];
  isTooBig?: boolean; // Flag for real-time size validation warning
  isViewingApprovedPosition?: boolean; // True when user is viewing approved position of overlay with pending changes
}

export type PanelTab = "latest" | "currentLocation" | "contribute" | "moderation";

export type OverlayForModeration = Pick<
  OverlayObject,
  | "id"
  | "filename"
  | "status"
  | "version"
  | "projectId"
  | "updatedAt"
  | "replacesOverlayId"
  | "replacedByOverlayId"
> & {
  caption: string | null;
  authorId: string | null; // For spam prevention reporting
  authorUsername?: string | null; // Display friendly username in moderation UI
  authorApprovedCount?: number | null; // User stats for spam detection (optional, only in moderation)
  authorRejectedCount?: number | null;
  authorReportCount?: number; // Number of reports for this user
  cityId: number | null;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  imageUrl?: string; // Optional for local overlays not yet uploaded
};

export type ProjectForModeration = Project & {
  overlays: OverlayForModeration[];
};

type BackendContributionOverlay =
  RouterOutput["project"]["getUsersContributions"]["projects"][number]["overlays"][number];

export type UserContributionOverlay = Omit<BackendContributionOverlay, "status"> & {
  // Status widens to allow null for local-only overlays that haven't been submitted
  status: ApprovalStatus | null;
  // imageUrl is the data URL or server URL used to render the thumbnail in the contributions panel
  imageUrl?: string;
};

// A user contribution is a Project augmented with the inline overlay list.
// Backend already populates the optional denormalized fields on Project (cityName, countryName, ownerUsername...).
export type UserContribution = Project & {
  overlays: UserContributionOverlay[];
};
