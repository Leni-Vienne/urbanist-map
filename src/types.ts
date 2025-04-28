import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { DBSchema } from "idb";

// Type for geographic coordinates
export type LatLng = {
  lat: number;
  lng: number;
};

// Extend Leaflet namespace to include custom actions
declare module "leaflet" {
  const DistortAction: any;
  const RotateAction: any;
  const FreeRotateAction: any;
  const OpacityAction: any;
  const OpacitiesAction: any;
  const DeleteAction: any;
  const StackAction: any;
  const Toolbar2: any;
  const EditAction: any;

  // Definition for DistortableImageOverlay
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

// Available image resolutions for an overlay
export type ImageResolutions = {
  original: string;
  medium?: string;
  small?: string;
  thumbnail?: string;
};

// Project information
export interface ProjectInfo {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
}

// Project data that is stored in the database
export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
  overlayIds: string[];
  color: string; // Color for visual grouping
}

// Data that is stored in the database
export interface StoredOverlayData {
  id: string;
  imageUrl: string;
  imageResolutions?: ImageResolutions;
  corners: { lat: number, lng: number }[];
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  projectId: string; // Required reference to project (no longer optional)
  phase?: string; // Optional phase information (e.g., "planning", "foundation", etc.)
  sequenceNumber?: number; // Optional sequence number for chronological ordering
}

// Extended overlay object with runtime properties
export interface OverlayObject extends StoredOverlayData {
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
  alreadyLoaded: boolean;
  alreadyStored: boolean;
  whitePixelsHidden: boolean;
  currentResolution?: string;
}

// Map position data structure
export interface MapPosition {
  key: string;
  value: {
    center: number[];
    zoom: number;
  };
}

// Database schema definition
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