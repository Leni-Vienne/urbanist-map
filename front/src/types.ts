import L from "leaflet";
import type { RouterOutput } from '@client';
import type {
  DBCountry,
  DBProject,
  DBOverlay,
  DBCity,
} from '../../back/src/db/schema';

// AI : Type for geographic coordinates
export type LatLng = {
  lat: number;
  lng: number;
};

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
  // AI : Leaflet distortableimage types - prefixed with _ to indicate intentionally unused
  const DistortAction: any;
  const RotateAction: any;
  const FreeRotateAction: any;
  const OpacityAction: any;
  const OpacitiesAction: any;
  const DeleteAction: any;
  const StackAction: any;
  const Toolbar2: any;
  const EditAction: any;
  const DragAction: any;
  const ResizeRotateAction: any;

  // AI : Definition for DistortableImageOverlay
  interface DistortableImageOverlay extends L.ImageOverlay {
    editing: {
      _disableKeyboard: () => void;
      addTool: (tool: any) => void;
      removeTool: (tool: any) => void;
    };
    getCorners: () => { lat: number, lng: number }[];
    setCorners: (corners: { lat: number, lng: number }[]) => void;
    bindTooltip: (content: string, options?: L.TooltipOptions) => this;
    openTooltip: () => this;
  }

  function distortableImageOverlay(imageUrl: string, options?: any): DistortableImageOverlay;
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
export type BackendProject = RouterOutput['cities']['getCityProjects'][number];

// AI : Transform the backend overlay format to match our expected CDN format
export interface CDNOverlayData {
  id: string;
  filename: string;
  caption?: string;
  projectId: string | null;
  project: (DBProject & {
    city: DBCity | null;
  }) | null;
  centroid: {
    lat: number;
    lng: number;
  };
  corners: { lat: number; lng: number }[];
  distance: number;
  createdAt: Date | null;
}

export type PendingOverlay = RouterOutput['moderation']['getPendingSubmissions']['overlays'][number];

// AI : Project information for forms
export interface ProjectInfo {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
}

// AI : Data that is stored in the database (local projects)
// AI : Based on Drizzle schema but with frontend-specific extensions
export type StoredProjectData = DBProject & {
  // AI : Frontend-specific fields
  savedRemotely?: boolean;
};

// AI : Runtime project data, including non-stored properties
export interface Project extends StoredProjectData {
  city?: DBCity;
  overlayIds: string[];
  color: string;
  // AI : Add computed property for name to maintain backward compatibility
  name: string;
}

// AI : Data that is stored in the database (based on Drizzle schema)
// AI : Local storage format with frontend-specific properties
export type StoredOverlayData = DBOverlay & {
  // AI : Frontend-specific fields for local functionality
  imageUrl: string; // AI : Derived from filename for display
  history: { lat: number, lng: number }[][]; // AI : For undo/redo functionality
  redoStack: { lat: number, lng: number }[][]; // AI : For undo/redo functionality
  savedRemotely?: boolean; // AI : Track if overlay exists on server
  // AI : Override centroid from Drizzle geometry to simple coordinate format for frontend use
  centroid: { x: number; y: number }; // AI : x=lng, y=lat
  // AI : Note: All core Drizzle fields are included from DBOverlay:
  // - id, filename, caption, status, projectId, authorId, metadata
  // - topLeftLat, topLeftLng, topRightLat, topRightLng, bottomRightLat, bottomRightLng, bottomLeftLat, bottomLeftLng
  // - centroid (overridden above), createdAt, updatedAt
};

// AI : Define a simplified version of overlay data for the list component
export interface OverlayListItem {
  id: string;
  caption?: string;
  distance?: number; // AI : For view mode display
  filename?: string; // AI : For CDN URL construction in view mode
}

// AI : Extended overlay object with runtime properties
export interface OverlayObject extends StoredOverlayData {
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
  alreadyLoaded: boolean;
  alreadyStored: boolean;
  whitePixelsHidden: boolean;
  isFlipped: boolean; // AI : Track if the image has been flipped after ratio reset
  currentResolution?: string;
  // AI : Project data for backend overlays (from CDN data)
  project?: CDNOverlayData['project'];
  // AI : Temporary field for backward compatibility - will be removed in favor of individual lat/lng fields
  corners: { lat: number, lng: number }[];
}