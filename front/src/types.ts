import L from "leaflet";
import { DBSchema } from "idb";

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
  // oxlint isn't happy about those but it avoids typescript errors due to leaflet distortableimage lacking types
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

// Type declarations for global interface extensions
declare global {
  interface Window {
    router: any;
    isUrlChangeFromClick: any;
  }
}

// AI : Available image resolutions for an overlay
export type ImageResolutions = {
  original: string;
  medium?: string;
  small?: string;
  originalWidth?: number; // AI: Original image width for resolution calculations
  originalHeight?: number; // AI: Original image height for resolution calculations
};

// AI : Project information
export interface ProjectInfo {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
}

// AI : Project data that is stored in the database
export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  startDate: Date | null;
  endDate: Date | null;
  sourceUrl: string;
  overlayIds: string[];
  color: string; // AI : Color for visual grouping
  createdAt: string; // AI : ISO string date of creation
  updatedAt: string; // AI : ISO string date of last update
}

// AI : Data that is stored in the database
export interface StoredOverlayData {
  id: string;
  imageUrl: string;
  imageResolutions?: ImageResolutions;
  corners: { lat: number, lng: number }[];
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  projectId: string; // AI : Required reference to project (no longer optional)
  phase?: string; // AI : Optional phase information (e.g., "planning", "foundation", etc.)
  sequenceNumber?: number; // AI : Optional sequence number for chronological ordering
  savedRemotely?: boolean; // AI : Track if overlay exists on server database
}

// AI : CDN overlay data returned by tRPC for view mode
export interface CDNOverlayData {
  id: string;
  filename: string; // AI : For CDN URL construction
  phase?: string;
  sequenceNumber?: number | null;
  centroid: {
    lat: number;
    lng: number;
  };
  // AI : All corner coordinates for proper overlay positioning (exactly 4 corners)
  corners: { lat: number; lng: number }[];
  distance: number;
  createdAt: Date | null;
}

// AI : Define a simplified version of overlay data for the list component
export interface OverlayListItem {
  id: string;
  phase?: string;
  sequenceNumber?: number;
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