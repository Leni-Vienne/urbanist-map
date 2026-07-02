import type { RouterOutput } from "@/client";
import type { DBProject, DBImportSource, ApprovalStatus } from "../../../back/src/db/schema";

// Type definitions for field modifications in submission dialogs
export type ModifiableField = "caption" | "corners";
export type RemovableChange = ModifiableField | "new_overlay" | "geometry" | "render";

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

export type PendingChangeRequest =
  RouterOutput["moderation"]["getPendingSubmissions"]["changeRequests"][0];

export type LatestContribution = RouterOutput["feed"]["getLatestContributions"][number];

// Base runtime project type - extends DB schema with computed fields.
// indexable is a server-only SEO column, never selected into client queries, so it is omitted here.
export interface Project extends Omit<DBProject, "status" | "tags" | "slug" | "indexable"> {
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

  // Cached overlay count for list views that don't hydrate the full overlays array.
  overlayCount?: number;

  // The project's render (artist's impression), attached by project.getById. Scoped server-side to
  // approved or the requester's own pending render. undefined = not loaded; null = loaded, none.
  render?: ProjectRender | null;

  // Inline overlay list, populated by the contribution/moderation endpoints (getUsersContributions,
  // getPendingSubmissions). Absent on projects loaded from the viewport/detail paths, which carry
  // overlayIds instead and render overlays from overlayStore.
  overlays?: Overlay[];
}

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
type ApiOverlayData = RouterOutput["viewport"]["getOverlaysInViewport"][number];

// Frontend overlay data type - extends API type with:
// - null status for local overlays not yet submitted to the backend
// - nullable project for local overlays constructed without a project join
// - optional fields that are absent on locally-constructed overlays
export type OverlayData = Omit<
  ApiOverlayData,
  | "status"
  | "project"
  | "distance"
  | "corners"
  | "suggestedCorners"
  | "hasPendingChanges"
  | "pendingChangeRequestsCount"
> & {
  status: ApprovalStatus | null;
  project?: ApiOverlayData["project"] | Project | null;
  distance?: number;
  // The immutable backend/approved corners. The live edited position lives on the GL image
  // (getOverlayImageCorners) and undo steps in history[]; this is only the server baseline.
  baselineCorners: ApiOverlayData["corners"];
  suggestedCorners?: LatLng[];
  hasPendingChanges?: boolean;
  pendingChangeRequestsCount?: number;
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
  corners: LatLng[];
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

export type PanelTab = "latest" | "currentLocation" | "filter" | "contribute" | "moderation";

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
