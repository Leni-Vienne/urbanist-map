import type * as L from "leaflet";
import type { RouterOutput } from "@/client";
import type { DBCountry, DBProject, DBCity, ApprovalStatus } from "../../../back/src/db/schema";

// Type definitions for field modifications in submission dialogs
export type ModifiableField = "caption" | "corners";
export type RemovableChange = ModifiableField | "new_overlay" | "geometry";

// Type for marker colors used throughout the application
export type MarkerColor = "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "grey";
export type viewModeMarkerColor = "yellow" | "orange" | "blue" | "green" | "grey";

// Interface for camera bounds used in view mode
export interface CameraBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}

// Extend Leaflet namespace to include custom actions
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

  // Definition for DistortableImageOverlay
  interface DistortableImageOverlay extends L.ImageOverlay {
    actions: DistortableAction[];
    editing: {
      _disableKeyboard: () => void;
      addTool: (tool: InstanceType<DistortableAction>) => void;
      removeTool: (tool: InstanceType<DistortableAction>) => void;
    };
    getCorners: () => L.LatLng[];
    setCorners: (corners: L.LatLng[] | { lat: number; lng: number }[]) => void;
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
    //cornersOrder?: "default" | "clockwise"; // 'default': [NW, NE, SW, SE], 'clockwise': [NW, NE, SE, SW]
  }

  function distortableImageOverlay(
    imageUrl: string,
    options?: DistortableImageOverlayOptions,
  ): DistortableImageOverlay;
}

// tRPC-inferred types from backend API (for transformed data)
export type City = RouterOutput["cities"]["getCitiesNearLocation"][number];

// Extended Country type for frontend use with additional properties
export interface Country extends DBCountry {
  lat: number;
  lng: number;
  projectCount: number;
  cities: City[];
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
  // Always an array on the frontend — null coerced to [] at DB boundary
  tags: string[];
  // UI state for tracking local modifications
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
  tags: string[];
  timelineStatus: "proposed" | "planned" | "under_construction" | "completed" | "canceled";
}

// Import shared overlay data type
import type { OverlayData } from "@shared/types";
export type { OverlayData } from "@shared/types";

// Frontend overlay type - extends backend OverlayData with UI state
// Leaflet layer references (image overlay + marker) live in overlayRenderRegistry,
// not on this type. OverlayObject is pure domain data.
export interface OverlayObject extends OverlayData {
  // Computed fields
  imageUrl: string;

  // Editor state
  history: { lat: number; lng: number }[][];
  redoStack: { lat: number; lng: number }[][];
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
  name: string; // Display name
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
  | "timelineStatus"
  | "importSourceId"
  | "externalId"
  | "externalProperties"
  | "externalLastModified"
  | "lastImportedAt"
  | "sourceUrl"
  | "lat"
  | "lng"
  | "cityId"
> & {
  tags: string[] | null; // May be null for legacy projects without tags
  ownerId?: string | null; // For spam prevention reporting (optional, only in moderation)
  ownerUsername?: string | null; // Display friendly username in moderation UI
  ownerApprovedCount?: number | null; // User stats for spam detection (optional, only in moderation)
  ownerRejectedCount?: number | null;
  ownerReportCount?: number; // Number of reports for this user
  city?: {
    // Full city object with local name support
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

// PendingOverlay is defined in types/api.ts - import from there if needed

// Centralized UserContribution types handling local (nullable status) and backend data
type BackendUserContribution = RouterOutput["project"]["getUsersContributions"]["projects"][number];

export type UserContributionOverlay = Omit<
  BackendUserContribution["overlays"][number],
  "status" | "cityId" | "cityName" | "countryCode" | "countryName"
> & {
  status: ApprovalStatus | null;
  cityId: number | null; // Override: cityId is now nullable for imported projects
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  // Frontend-specific fields added by factories
  imageUrl?: string;
  authorUsername?: string | null;
  authorApprovedCount?: number | null;
  authorRejectedCount?: number | null;
};

export type UserContribution = Omit<BackendUserContribution, "status" | "overlays" | "cityId"> & {
  status: ApprovalStatus | null;
  cityId: number | null; // Override: cityId is now nullable for imported projects
  overlays: UserContributionOverlay[];
  // Date precision fields
  proposalDatePrecision?: "year" | "month" | "day" | null;
  startDatePrecision?: "year" | "month" | "day" | null;
  endDatePrecision?: "year" | "month" | "day" | null;
  // Frontend-specific fields added by factories
  ownerUsername?: string | null;
  ownerApprovedCount?: number | null;
  ownerRejectedCount?: number | null;
};
