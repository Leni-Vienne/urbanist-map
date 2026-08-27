import type { RouterOutput } from "@/client";
import type { DBProject, DBImportSource, ApprovalStatus } from "../../../back/src/db/schema";

// Type definitions for field modifications in submission dialogs
export type ModifiableField = "caption" | "corners";

export type LatLng = { lat: number; lng: number };

type CornersChange = {
  current: LatLng[];
  original: LatLng[];
};

type CaptionChange = {
  current: string | null;
  original: string | null;
};

export type PendingOverlayModification = {
  overlayId: string;
  projectId: string | null;
  overlayStatus: ApprovalStatus;
  corners?: CornersChange;
  caption?: CaptionChange;
};

// Type for marker colors used throughout the application
export type MarkerColor = "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "grey";

/**
 * Where an overlay's edit-session display rests.
 * - `baseline`: no open change request; rests at approved corners.
 * - `suggested`: open change request; rests on its proposed state (caption-only CRs included, whose
 *   proposed corners resolve to baseline).
 * - `approved-toggled`: open change request; user explicitly viewing the approved state.
 * - `staged`: unsubmitted corner edits; the position is the top of the undo history.
 */ export type OverlayPositionState = "baseline" | "suggested" | "staged" | "approved-toggled";

export type PendingChangeRequest =
  RouterOutput["moderation"]["getPendingSubmissions"]["changeRequests"][0];

export type LatestContribution = RouterOutput["feed"]["getLatestContributions"]["items"][number];

// Base runtime project type with frontend state and server-only storage fields omitted.
interface ProjectFields extends Omit<
  DBProject,
  | "status"
  | "tags"
  | "slug"
  | "indexable"
  | "centerCoordinate"
  | "adminBoundaryId"
  | "lastImportedAt"
  | "importLockedAt"
  | "detachedAt"
  | "rejectionReason"
> {
  // Always an array on the frontend, null coerced to [] at DB boundary
  tags: string[];
  // Joined import source details (null for user-created projects)
  importSource?: DBImportSource | null;
  hasImage?: boolean;

  // Denormalized country name, populated by location-aware queries (resolved from admin boundaries).
  countryName?: string | null;

  // Owner display + spam-detection fields, populated by moderation/contribution endpoints.
  ownerUsername?: string | null;
  ownerApprovedCount?: number | null;
  ownerRejectedCount?: number | null;
  ownerReportCount?: number;
}

export interface ProjectSummary extends ProjectFields {
  status: ApprovalStatus;
}

export interface ProjectDetailFields {
  // Permanent SEO slug for the /project/<slug> deep link.
  slug: string | null;
  // The project's render, scoped server-side to approved or the requester's own pending render.
  render: ProjectRender | null;
  ownerUsername: string | null;
  // Administrative breadcrumb ordered deepest-first. [] means no matching boundary.
  boundaryPath:
    | {
        name: string;
        nameEn: string | null;
        names: Record<string, string> | null;
        adminLevel: number;
      }[]
    | null;
}

// Most consumers only need the summary. Detail fields stay optional until getById/getBySlug supplies
// all of them; HydratedProject represents that complete state without a separate completeness ledger.
export type LocalProject = ProjectFields & { status: null };

export type Project = (ProjectSummary | LocalProject) & Partial<ProjectDetailFields>;

export type HydratedProject = ProjectSummary & ProjectDetailFields;

// A non-georeferenced project image (artist's impression). Stored as a kind='render' overlay.
interface ProjectRender {
  filename: string;
  caption: string | null;
  status: ApprovalStatus;
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
  sourceUrl: string | null;
  tags: string[];
  timelineStatus: "proposed" | "planned" | "under_construction" | "completed" | "canceled";
}

// Wire format from backend API - derived automatically from tRPC route output
type ApiOverlayData = RouterOutput["viewport"]["getEditSessionData"]["overlays"][number];

// Frontend overlay data type - extends API type with:
// - null status for local overlays not yet submitted to the backend
// - optional fields that are absent on locally-constructed overlays
export type OverlayData = Omit<
  ApiOverlayData,
  "status" | "corners" | "suggestedCorners" | "suggestedCaption" | "hasPendingChanges"
> & {
  status: ApprovalStatus | null;
  // The immutable backend/approved corners, or null when the overlay has no placed footprint
  // (an un-placed local upload before its corners are computed, or a render with null corners).
  // Staged edits live in history[]; this is only the server baseline.
  baselineCorners: LatLng[] | null;
  // The immutable backend/approved caption, copied from the wire `caption` at ingest and never
  // overwritten by edits (the mirror of baselineCorners). The live edited caption stays on `caption`.
  baselineCaption: string | null;
  // The current user's own open change request on this overlay: whether one exists, and the
  // corners/caption they proposed. Never another requester's, in any mode.
  suggestedCorners?: LatLng[];
  suggestedCaption?: string | null;
  hasPendingChanges?: boolean;
};

export type BackendOverlayData = OverlayData & {
  status: ApprovalStatus;
};

// Property bag of a vector-tile feature. The MVT wire format carries scalars only, so a list value
// such as `tags` arrives as a JSON string and has to be parsed by the reader.
export type TileProperties = Record<string, string | number | boolean | null>;

// Lightweight overlay data decoded from the approved-overlay vector tile. It contains only tile
// fields and values derived directly from them; session-only metadata stays on OverlayData.
export interface TileOverlayData {
  id: string;
  filename: string;
  caption: string | null;
  status: "approved";
  projectId: string | null;
  centroid: LatLng;
  baselineCorners: LatLng[];
  baselineCaption: string | null;
}

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
  corners: LatLng[];
  imageUrl: string;
  cropRect?: NormalizedRect;
}

export interface OverlayObject extends OverlayData {
  imageUrl: string;

  // Editor state
  history: OverlayHistoryState[];
  redoStack: OverlayHistoryState[];
  isTooBig?: boolean; // Flag for real-time size validation warning
  positionState: OverlayPositionState;
}

export type PanelTab = "explore" | "filter" | "contribute" | "moderation";

// Author identity + spam-detection stats forwarded up the contributor-click chain to UserStatsDialog.
// The counts are optional because list endpoints hydrate them, but map/editor contexts do not.
export interface UserStatsPayload {
  userId: string;
  username?: string | null;
  approvedCount?: number | null;
  rejectedCount?: number | null;
  reportCount?: number;
}

// Wire shape of an overlay row as the contribution/moderation endpoints return it.
type BackendOverlayMetadata =
  RouterOutput["project"]["getUsersContributions"]["projects"][number]["overlays"][number];

// List-metadata overlay: the lightweight overlay shape used by My Contributions and Moderation
// (OverlayObject is the heavier map/editor runtime overlay). Core fields are present in every
// context; the grouped optionals are hydrated only by specific endpoints.
export type Overlay = Omit<
  BackendOverlayMetadata,
  | "status"
  | "authorUsername"
  | "authorApprovedCount"
  | "authorRejectedCount"
  | "countryCode"
  | "countryName"
> & {
  // null for local overlays not yet submitted to the backend
  status: ApprovalStatus | null;
  // data URL or server URL used to render the thumbnail; absent until the image is uploaded
  imageUrl?: string;

  // Author display + spam-detection stats, populated by moderation/contribution endpoints.
  authorUsername?: string | null;
  authorApprovedCount?: number | null;
  authorRejectedCount?: number | null;
  // Number of reports for this overlay's author, populated only by moderation getPendingSubmissions.
  authorReportCount?: number;

  // Denormalized location, populated by moderation/contribution endpoints.
  countryCode?: string | null;
  countryName?: string | null;
};

// A project as surfaced in contribution and moderation lists, with its inline overlays loaded.
export type ContributionProject = Project & { overlays: Overlay[] };
