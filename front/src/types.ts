import L from "leaflet";
import type { RouterOutput } from "@client";
import type { DBCountry, DBProject, DBCity } from "../../back/src/shared/schema";

// AI : Type for marker colors used throughout the application
export type MarkerColor =
  | "blue"
  | "green"
  | "orange"
  | "red"
  | "gold"
  | "yellow"
  | "purple"
  | "grey"
  | "black";
export type viewModeMarkerColor = "yellow" | "orange" | "grey" | "green";

// AI : Type for map viewing modes
export type MapMode = "view" | "edit" | "moderation";

// AI : Type for project manager modes
export type ProjectManagerMode = "list" | "edit" | "view" | "create";

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

  // AI : Leaflet.Toolbar type definitions (not included in the package)
  /* eslint-disable @typescript-eslint/no-unused-vars */
  namespace Toolbar2 {
    class Action extends L.Handler {
      constructor(map: L.Map, options: any);
      static extend(options: any): any;
      initialize?(...args: any[]): void;
    }
    class Toolbar extends L.Control {
      constructor(options: any);
    }
  }

  // AI : Toolbar2 constructor (used in toolbar actions)
  class Toolbar2 extends L.Evented {
    constructor(options?: { actions?: typeof Toolbar2.Action[] });
  }

  // AI : Leaflet distortableimage types - prefixed with _ to indicate intentionally unused
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const DistortAction: typeof L.Toolbar2.Action;
  const RotateAction: typeof L.Toolbar2.Action;
  const FreeRotateAction: typeof L.Toolbar2.Action;
  const OpacityAction: typeof L.Toolbar2.Action;
  const OpacitiesAction: typeof L.Toolbar2.Action;
  const DeleteAction: typeof L.Toolbar2.Action;
  const StackAction: typeof L.Toolbar2.Action;
  const EditAction: typeof L.Toolbar2.Action;
  const DragAction: typeof L.Toolbar2.Action;
  const ResizeRotateAction: typeof L.Toolbar2.Action;

  const IconUtil: IconUtils;

  interface IconUtils {
    create: () => string;
    addClassToSvg: () => void;
    toggleXlink: (el: HTMLElement, on_class: string, off_class: string) => void;
    toggleTitle: (el: HTMLElement, on_title: string, off_title: string) => void;
  }

  // AI : Definition for DistortableImageOverlay
  interface DistortableImageOverlay extends L.ImageOverlay {
    actions: L.Toolbar2.Action[];
    editing: {
      _disableKeyboard: () => void;
      addTool: (tool: L.Toolbar2.Action) => void;
      removeTool: (tool: L.Toolbar2.Action) => void;
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
    actions?: L.Toolbar2.Action[];
    corners?: { lat: number; lng: number }[];
    editable?: boolean;
    keyboard?: boolean;
    dragBehavior?: "map" | "overlay" | "auto";
    selectOnDrag: boolean;
    draggable: boolean;
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

// AI : Base runtime project type - extends DB schema with computed fields
export interface Project extends Omit<DBProject, "status"> {
  // AI : Override status to allow null for local unsubmitted projects
  status: "pending" | "approved" | "rejected" | "replaced" | null;
  // AI : Computed fields for all contexts
  city: DBCity;
  overlayIds: string[];
  name: string; // AI : Computed from project name field
  // AI : Center coordinates for all projects (used as marker when no overlays exist)
  mapCoordinates?: { lat: number; lng: number } | null;
  // AI : UI state for tracking local modifications
  isModified?: boolean;
}

// AI : Import shared overlay data type from backend
import type { OverlayData } from "../../back/src/shared/types";
export type { OverlayData } from "../../back/src/shared/types";

// AI : Frontend overlay type - extends backend OverlayData with UI state
export interface OverlayObject extends OverlayData {
  // AI : Computed fields
  imageUrl: string;

  // AI : Map interaction fields
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;

  // AI : Editor state
  history: { lat: number; lng: number }[][];
  redoStack: { lat: number; lng: number }[][];
  isTooBig?: boolean; // AI : Flag for real-time size validation warning
  isViewingApprovedPosition?: boolean; // AI : True when user is viewing approved position of overlay with pending changes
}

// AI : Utility types for specific use cases
export type ProjectForForm = Pick<
  Project,
  "name" | "description" | "sourceUrl" | "startDate" | "endDate"
> & {
  projectName: string; // AI : Alias for name in forms
  sourceLink: string; // AI : Alias for sourceUrl in forms
};

export type ProjectForList = Pick<
  Project,
  "id" | "name" | "description" | "createdAt" | "updatedAt" | "cityId"
> & {
  overlayCount?: number;
  cityName?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
};

export type OverlayForList = Pick<OverlayObject, "id" | "caption" | "filename"> & {
  distance?: number;
};

export type OverlayForModeration = Pick<
  OverlayObject,
  "id" | "filename" | "status" | "version" | "projectId" | "updatedAt" | "replacesOverlayId"
> & {
  name: string; // AI : Display name
  authorId: string | null; // AI : For spam prevention reporting
  authorUsername?: string | null; // AI : Display friendly username in moderation UI
  authorApprovedCount?: number | null; // AI : User stats for spam detection (optional, only in moderation)
  authorRejectedCount?: number | null;
  authorReportCount?: number; // AI : Number of reports for this user
  cityId: string | null;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
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
  | "endDate"
  | "proposalDate"
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
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  overlays: OverlayForModeration[];
  overlayCount?: number;
};

// AI : Keep specific types that have unique structure
export type PendingOverlay =
  RouterOutput["moderation"]["getPendingSubmissions"]["overlays"][number];
