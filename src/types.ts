import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { DBSchema } from "idb";

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

  // Définition de l'interface pour DistortableImageOverlay
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

export type StoredOverlayData = {
  id: string;
  imageUrl: string;
  corners: { lat: number, lng: number }[];
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  info: info | null;
}

export type info = {
  projectName: string;
  sourceLink: string;
  startDate: Date | null;
  endDate: Date | null;
  budget: number;
}

export type overlayObject = StoredOverlayData & {
  overlay: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
  alreadyLoaded: boolean;
  alreadyStored: boolean;
  whitePixelsHidden: boolean;
  }

export type mapPosition = {
  key: string;
  value: {
    center: number[];
    zoom: number;
  };
}

export interface MyDB extends DBSchema {
  mapPosition: {
    key: string;
    value: mapPosition
  };
  overlays: {
    key: string;
    value: StoredOverlayData;
  }
}