import * as L from "leaflet";
import type { RouterOutput } from "@/client";
import type { DBCountry, DBProject, DBCity, ApprovalStatus } from "../../../back/src/db/schema";

// AI : Type definitions for field modifications in submission dialogs
export type ModifiableField = "caption" | "corners";
export type RemovableChange = ModifiableField | "new_overlay";

// AI : Type for marker colors used throughout the application
export type MarkerColor = "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "grey";
export type viewModeMarkerColor = "yellow" | "orange" | "grey" | "green";

// AI : Interface for camera bounds used in view mode
export interface CameraBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}

// AI : Extend Leaflet namespace to include custom actions
declare module "leaflet" {
  interface MapOptions {
    doubleTapDragZoom?: boolean | "center";
    doubleTapDragZoomOptions?: {
      reverse?: boolean;
    };
  }

  interface Marker {
    overlayId?: string;
  }

  interface Map {
    _animatingZoom?: boolean; // _animatingZoom isn't documented for some reason
  }

  // Minimal type for DistortableImage edit actions (ResizeRotateAction, DistortAction, etc.)
  // leaflet-toolbar is loaded as a side-effect only; we never reference L.Toolbar2 directly.
  type DistortableAction = abstract new (...args: any[]) => object;

  // AI : Definition for DistortableImageOverlay
  interface DistortableImageOverlay extends L.ImageOverlay {
    actions: DistortableAction[];
    editing: {
      _disableKeyboard: () => void;
      addTool: (tool: InstanceType<DistortableAction>) => void;
      removeTool: (tool: InstanceType<DistortableAction>) => void;
    };
    getCorners: () => { lat: number; lng: number }[];
    setCorners: (corners: { lat: number; lng: number }[]) => void;
    setOptions: (options: Partial<DistortableImageOverlayOptions>) => void;
    bindTooltip: (content: string, options?: L.TooltipOptions) => this;
    openTooltip: () => this;
    select: () => void;
    deselect: () => void;
  }

  interface DistortableImageOverlayOptions extends L.ImageOverlayOptions {
    actions?: DistortableAction[];
    // resizeRotate is the most conveniant mode (tool) for the site
    mode:
      | "drag"
      | "scale"
      | "distort"
      | "rotate"
      | "freeRotate"
      | "resizeRotate"
      | "transform"
      | "lock";
    corners?: { lat: number; lng: number }[];
    editable?: boolean;
    keyboard?: boolean;
    dragBehavior?: "map" | "overlay" | "auto";
    selectOnDrag: boolean;
    draggable: boolean;
    suppressToolbar?: boolean;
  }

  function distortableImageOverlay(
    imageUrl: string,
    options?: DistortableImageOverlayOptions,
  ): DistortableImageOverlay;
}

// AI : tRPC-inferred types from backend API (for transformed data)
export type City = RouterOutput["cities"]["getCitiesNearLocation"][number];

// AI : Extended Country type for frontend use with additional properties
export interface Country extends DBCountry {
  lat: number;
  lng: number;
  projectCount: number;
  cities: City[];
}

export type PendingChangeRequest =
  RouterOutput["moderation"]["getPendingSubmissions"]["changeRequests"][0];

export type LatestContribution = RouterOutput["overlay"]["getLatestContributions"][number];
export type NearbyProject = RouterOutput["project"]["getProjectsNearLocation"]["projects"][0];

// AI : Base runtime project type - extends DB schema with computed fields
export interface Project extends Omit<DBProject, "status"> {
  // AI : Override status to allow null for local unsubmitted projects
  status: ApprovalStatus | null;
  // AI : Computed fields for all contexts
  city: DBCity;
  overlayIds: string[];
  name: string; // AI : Computed from project name field
  // AI : Center coordinates for all projects (used as marker when no overlays exist)
  mapCoordinates?: { lat: number; lng: number } | null;
  // AI : UI state for tracking local modifications
  isModified?: boolean;
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
  sourceUrl: string | null;
}

// AI : Import shared overlay data type
import type { OverlayData } from "@shared/types";
export type { OverlayData } from "@shared/types";

// AI : Frontend overlay type - extends backend OverlayData with UI state
// AI : Leaflet layer references (image overlay + marker) live in overlayRenderRegistry,
// AI : not on this type. OverlayObject is pure domain data.
export interface OverlayObject extends OverlayData {
  // AI : Computed fields
  imageUrl: string;

  // AI : Editor state
  history: { lat: number; lng: number }[][];
  redoStack: { lat: number; lng: number }[][];
  isTooBig?: boolean; // AI : Flag for real-time size validation warning
  isViewingApprovedPosition?: boolean; // AI : True when user is viewing approved position of overlay with pending changes
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
  name: string; // AI : Display name
  authorId: string | null; // AI : For spam prevention reporting
  authorUsername?: string | null; // AI : Display friendly username in moderation UI
  authorApprovedCount?: number | null; // AI : User stats for spam detection (optional, only in moderation)
  authorRejectedCount?: number | null;
  authorReportCount?: number; // AI : Number of reports for this user
  cityId: number | null;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  imageUrl?: string; // AI : Optional for local overlays not yet uploaded
};

export type ProjectForModeration = Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "status"
  | "version"
  | "createdAt"
  | "updatedAt"
  | "startDate"
  | "startDatePrecision"
  | "endDate"
  | "endDatePrecision"
  | "proposalDate"
  | "proposalDatePrecision"
  | "sourceUrl"
  | "lat"
  | "lng"
  | "cityId"
> & {
  ownerId?: string | null; // AI : For spam prevention reporting (optional, only in moderation)
  ownerUsername?: string | null; // AI : Display friendly username in moderation UI
  ownerApprovedCount?: number | null; // AI : User stats for spam detection (optional, only in moderation)
  ownerRejectedCount?: number | null;
  ownerReportCount?: number; // AI : Number of reports for this user
  city?: {
    // AI : Full city object with local name support
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
  } | null;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  overlays: OverlayForModeration[];
  overlayCount?: number;
};

// AI : PendingOverlay is defined in types/api.ts - import from there if needed

// AI : Centralized UserContribution types handling local (nullable status) and backend data
type BackendUserContribution = RouterOutput["project"]["getUsersContributions"]["projects"][number];

export type UserContributionOverlay = Omit<
  BackendUserContribution["overlays"][number],
  "status"
> & {
  status: ApprovalStatus | null;
  // AI : Frontend-specific fields added by factories
  imageUrl?: string;
  authorUsername?: string | null;
  authorApprovedCount?: number | null;
  authorRejectedCount?: number | null;
};

export type UserContribution = Omit<BackendUserContribution, "status" | "overlays"> & {
  status: ApprovalStatus | null;
  overlays: UserContributionOverlay[];
  // AI : Date precision fields
  proposalDatePrecision?: "year" | "month" | "day" | null;
  startDatePrecision?: "year" | "month" | "day" | null;
  endDatePrecision?: "year" | "month" | "day" | null;
  // AI : Frontend-specific fields added by factories
  ownerUsername?: string | null;
  ownerApprovedCount?: number | null;
  ownerRejectedCount?: number | null;
};
