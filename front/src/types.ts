import L from "leaflet";
import type { RouterOutput } from '@client';
import type {
  DBCountry,
  DBProject,
  DBOverlay,
  DBCity,
} from '../../back/src/db/schema';

// AI : Type for marker colors used throughout the application
export type MarkerColor = 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'purple' | 'grey' | 'black';

// AI : Type for project manager modes
export type ProjectManagerMode = 'list' | 'edit' | 'view' | 'create';

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
    doubleTapDragZoom?: boolean | 'center';
    doubleTapDragZoomOptions?: {
      reverse?: boolean;
    };
  }

  interface Marker {
    overlayId?: string;
  }

  // AI : Leaflet.Toolbar type definitions
  namespace Toolbar2 {
    class Action extends L.Handler {
      constructor(map: L.Map, options: any);
      static extend(options: any): any;
    }
    class Toolbar extends L.Control {
      constructor(options: any);
    }
  }

  // AI : Leaflet distortableimage types - prefixed with _ to indicate intentionally unused
  const DistortAction: typeof L.Toolbar2.Action;
  const RotateAction: typeof L.Toolbar2.Action;
  const FreeRotateAction: typeof L.Toolbar2.Action;
  const OpacityAction: typeof L.Toolbar2.Action;
  const OpacitiesAction: typeof L.Toolbar2.Action;
  const DeleteAction: typeof L.Toolbar2.Action;
  const StackAction: typeof L.Toolbar2.Action;
  //const Toolbar2: L.Toolbar2.Toolbar;
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
    getCorners: () => { lat: number, lng: number }[];
    setCorners: (corners: { lat: number, lng: number }[]) => void;
    bindTooltip: (content: string, options?: L.TooltipOptions) => this;
    openTooltip: () => this;
  }

  interface DistortableImageOverlayOptions extends L.ImageOverlayOptions {
    actions?: L.Toolbar2.Action[];
    corners?: L.LatLng[];
    editable?: boolean;
    keyboard?: boolean;
  }

  function distortableImageOverlay(imageUrl: string, options?: DistortableImageOverlayOptions): DistortableImageOverlay;
}

// AI : tRPC-inferred types from backend API (for transformed data)
export type City = RouterOutput['cities']['getCitiesNearLocation'][number];

// AI : Extended Country type for frontend use with additional properties
export interface Country extends DBCountry {
  lat: number;
  lng: number;
  projectCount: number;
  cities: City[];
}

// AI : Extract backend project data from city projects
// AI : getCityProjects now returns CDNOverlayData array directly
export type BackendCityOverlay = RouterOutput['cities']['getCityProjects'][number];

// AI : Transform the backend overlay format to match our expected CDN format
export interface CDNOverlayData {
  id: string;
  filename: string;
  caption?: string | null;
  projectId: string | null;
  replacesOverlayId?: string | null;
  project: (DBProject & {
    city?: DBCity | null;
  }) | null;
  centroid: {
    lat: number;
    lng: number;
  };
  corners: { lat: number; lng: number }[];
  distance: number;
  createdAt: Date | null;
  isModified?: boolean; // AI : Track if overlay has been modified locally
}

export type PendingOverlay = RouterOutput['moderation']['getPendingSubmissions']['overlays'][number];

// AI : Define a simplified version of overlay data for the list component
export interface OverlayListItem {
  id: string;
  caption?: string;
  distance?: number; // AI : For view mode display
  filename?: string; // AI : For CDN URL construction in view mode
}

// AI : Project information for forms
export interface ProjectInfo {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
}

// AI : Runtime project data - directly extends Drizzle schema
export interface Project extends DBProject {
  city?: DBCity | null;
  overlayIds: string[];
  color: string;
  // AI : Add computed property for name to maintain backward compatibility
  name: string;
  // AI : Add sourcePdf field for PDF file uploads (File object or null)
  sourcePdf?: File | null;
  // AI : Track if project exists on server (vs locally created)
  savedRemotely?: boolean;
}

// AI : Runtime overlay data - directly extends Drizzle schema with frontend-specific fields
export interface OverlayObject extends DBOverlay {
  // AI : Frontend-specific fields for local functionality
  imageUrl: string; // AI : Derived from filename for display
  history: { lat: number, lng: number }[][]; // AI : For undo/redo functionality
  redoStack: { lat: number, lng: number }[][]; // AI : For undo/redo functionality
  // AI : Override centroid from Drizzle geometry to simple coordinate format for frontend use
  centroid: { x: number; y: number }; // AI : x=lng, y=lat
  // AI : Runtime properties for map interactions
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
  whitePixelsHidden: boolean;
  isFlipped: boolean; // AI : Track if the image has been flipped after ratio reset
  currentResolution?: string;
  // AI : Project data for backend overlays (from CDN data)
  project?: CDNOverlayData['project'];
  // AI : Temporary field for backward compatibility - will be removed in favor of individual lat/lng fields
  corners: { lat: number, lng: number }[];
// AI : Track if overlay has been modified locally (moved, rotated, scaled, etc.)
  isModified: boolean;
  savedRemotely: boolean;
}

// AI : Frontend version of backend's OverlayWithDetails
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

// AI : Specific types for accordion panels to ensure consistency
export interface AccordionOverlay {
  id: string;
  name: string;
  filename: string;
  status: 'pending' | 'approved' | 'rejected';
  projectId: string | null;
  updatedAt: Date;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
}

export interface AccordionProject {
  id: string;
  name: string;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date | null;
  updatedAt: Date;
  startDate: Date | null;
  endDate: Date | null;
  sourceUrl: string | null;
  cityName: string | null;
  countryCode: string | null;
  countryName: string | null;
  overlays: AccordionOverlay[];
  overlayCount?: number;
}
