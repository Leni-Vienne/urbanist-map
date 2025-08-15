import L from "leaflet";
import type { RouterOutput } from '@client';
import type {
  DBCountry,
  DBProject,
  DBOverlay,
  DBCity,
} from '../../back/src/db/schema';

// AI : Type for marker colors used throughout the application
export type MarkerColor = 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black';

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
// AI : getCityProjects now returns CDNOverlayData array directly
export type BackendCityOverlay = RouterOutput['cities']['getCityProjects'][number];

// AI : Transform the backend overlay format to match our expected CDN format
export interface CDNOverlayData {
  id: string;
  filename: string;
  caption?: string;
  projectId: string | null;
  replacesOverlayId?: string | null;
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
  city?: DBCity;
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
}