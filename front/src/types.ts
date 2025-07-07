import L from "leaflet";
import { DBSchema } from "idb";
import type { RouterOutput } from '@client';
import type { 
  DBCountry, 
  DBProject, 
  DBOverlay
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
  const _DistortAction: any;
  const _RotateAction: any;
  const _FreeRotateAction: any;
  const _OpacityAction: any;
  const _OpacitiesAction: any;
  const _DeleteAction: any;
  const _StackAction: any;
  const _Toolbar2: any;
  const _EditAction: any;
  const _DragAction: any;
  const _ResizeRotateAction: any;

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
  project: {
    id: string;
    title: string;
    description: string | null;
    cityId: string | null;
    city: {
      id: string | null;
      name: string;
      countryCode: string;
    } | null;
    metadata: any;
    createdAt: Date | null;
    updatedAt: Date | null;
  } | null;
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

// AI : Project data that is stored in the database (local projects)
// AI : Based on Drizzle schema but with frontend-specific extensions
export interface Project extends Omit<DBProject, 'title' | 'ownerId' | 'status'> {
  name: string; // AI : Frontend uses 'name' instead of 'title'
  location: string; // AI : Frontend-specific location string
  city?: City; // AI : City information included from backend joins
  overlayIds: string[]; // AI : Array of overlay IDs for this project
  color: string; // AI : Color for visual grouping
  savedRemotely?: boolean; // AI : Track if project exists on server database
}

// AI : Data that is stored in the database (based on Drizzle schema)
// AI : Local storage format with frontend-specific properties
export interface StoredOverlayData extends Omit<DBOverlay, 'topLeftLat' | 'topLeftLng' | 'topRightLat' | 'topRightLng' | 'bottomRightLat' | 'bottomRightLng' | 'bottomLeftLat' | 'bottomLeftLng' | 'centroid' | 'status' | 'authorId'> {
  imageUrl: string; // AI : Frontend uses imageUrl for local storage
  corners: { lat: number, lng: number }[]; // AI : Simplified corners array format
  history: { lat: number, lng: number }[][]; // AI : Undo history for overlay transformations
  redoStack: { lat: number, lng: number }[][]; // AI : Redo stack for overlay transformations
  savedRemotely?: boolean; // AI : Track if overlay exists on server database
}

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
  savedRemotely?: boolean; // AI : Track if overlay exists on server database
  // AI : Project data for backend overlays (from CDN data)
  project?: {
    id: string;
    title: string;
    description?: string | null;
    metadata?: any;
    createdAt: Date | null;
    updatedAt: Date | null;
  } | null;
}

// AI : Map position data structure
export interface MapPosition {
  key: string;
  value: {
    center: number[];
    zoom: number;
  };
}

// AI : Database schema definition
export interface MyDB extends DBSchema {
  mapPosition: {
    key: string;
    value: MapPosition;
  };
  overlays: {
    key: string;
    value: StoredOverlayData;
  };
  projects: {
    key: string;
    value: Project;
  };
}
