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

// Which pipeline built an OverlayData object. Tile-sourced data carries no change-request state.
type OverlayDataSource = "tile" | "bbox" | "local";

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
export interface Project extends Omit<
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
  // Override status to allow null for local unsubmitted projects
  status: ApprovalStatus | null;
  // Permanent SEO slug for the /project/<slug> deep link. Selected only by getById/getBySlug, so it
  // is absent (undefined) on projects loaded from the viewport payload. Used to sync the address bar.
  slug?: string | null;
  // Computed fields for all contexts
  overlayIds: string[];
  // Always an array on the frontend, null coerced to [] at DB boundary
  tags: string[];
  // Joined import source details (null for user-created projects)
  importSource?: DBImportSource | null;
  // UI state for tracking local modifications
  isModified?: boolean;

  // Denormalized country name, populated by location-aware queries (resolved from admin boundaries).
  countryName?: string | null;

  // Administrative breadcrumb ordered deepest-first (neighborhood, city, state, country), attached by
  // project.getById from the admin boundary parent chain. undefined = not loaded; [] = no boundary.
  // Each entry ships all name variants so the client picks by UI locale (names?.[locale] ?? nameEn ?? name).
  boundaryPath?:
    | {
        name: string;
        nameEn: string | null;
        names: Record<string, string> | null;
        adminLevel: number;
      }[]
    | null;

  // Owner display + spam-detection fields, populated by moderation/contribution endpoints.
  ownerUsername?: string | null;
  ownerApprovedCount?: number | null;
  ownerRejectedCount?: number | null;
  ownerReportCount?: number;

  // The project's render (artist's impression), attached by project.getById. Scoped server-side to
  // approved or the requester's own pending render. undefined = not loaded; null = loaded, none.
  render?: ProjectRender | null;

  // Inline overlay list, populated by the contribution/moderation endpoints (getUsersContributions,
  // getPendingSubmissions). Absent on projects loaded from the viewport/detail paths, which carry
  // overlayIds instead and render overlays from overlayStore.
  overlays?: Overlay[];
}

// Fields returned only by the project detail endpoints. `null` remains a meaningful loaded value;
// the required properties distinguish it from an omitted summary field.
export type ProjectDetailFields = Required<
  Pick<Project, "slug" | "render" | "ownerUsername" | "boundaryPath">
>;

export type HydratedProject = Project & ProjectDetailFields;

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
// - nullable project for local overlays constructed without a project join
// - optional fields that are absent on locally-constructed overlays
export type OverlayData = Omit<
  ApiOverlayData,
  "status" | "project" | "corners" | "suggestedCorners" | "suggestedCaption" | "hasPendingChanges"
> & {
  status: ApprovalStatus | null;
  project?: ApiOverlayData["project"] | Project | null;
  // The immutable backend/approved corners, or null when the overlay has no placed footprint
  // (an un-placed local upload before its corners are computed, or a render with null corners).
  // The live edited position lives on the GL image (getOverlayImageCorners) and undo steps in
  // history[]; this is only the server baseline.
  baselineCorners: LatLng[] | null;
  // The immutable backend/approved caption, copied from the wire `caption` at ingest and never
  // overwritten by edits (the mirror of baselineCorners). The live edited caption stays on `caption`.
  baselineCaption: string | null;
  // The current user's own open change request on this overlay: whether one exists, and the
  // corners/caption they proposed. Never another requester's, in any mode.
  suggestedCorners?: LatLng[];
  suggestedCaption?: string | null;
  hasPendingChanges?: boolean;
  // Which pipeline built this data object (tile-sourced data carries no change-request state).
  source: OverlayDataSource;
};

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

export type PanelTab = "latest" | "filter" | "contribute" | "moderation";

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

// A project as surfaced in My Contributions: its overlay list is always hydrated (backend metadata,
// local unsubmitted overlays, and staged renders merged in), unlike the optional overlays on Project.
export type ContributionProject = Project & { overlays: Overlay[] };
