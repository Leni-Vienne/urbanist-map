import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { ref, shallowRef } from 'vue';
import { map } from './useMap';
import { getAllOverlays } from './useDatabase';
import type { overlayObject, StoredOverlayData, info } from '../types';
import { editTools, viewTools, infoTool } from './useTools';

export const overlays = shallowRef<Record<string, overlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(true);

export async function initializeOverlays() {
  const savedOverlays = await getAllOverlays();
  savedOverlays.forEach(async (savedOverlay) => {
    const overlayObject = createOverlayObject(savedOverlay);
    const newOverlay = await createOverlay(savedOverlay.imageUrl, overlayObject);
    overlayObject.overlay = newOverlay!;
    overlays.value[savedOverlay.id] = overlayObject;
  });
}

export function createOverlayObject(savedOverlay: StoredOverlayData): overlayObject {
    return {
    ...savedOverlay,
        overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
  };
}

export async function createOverlay(imageUrl: string, overlayObject?: overlayObject) {
  if (!map.value || !overlayObject) return null;

  if (!overlayObject.imageUrl) {
    overlayObject.imageUrl = imageUrl;
  }
  const newOverlay = L.distortableImageOverlay(imageUrl, {
    editable: true,
    tooltipText: overlayObject.info?.projectName,
    keyboard: false,
    actions: [
      infoTool,
      ...editTools
    ],
  }).addTo(map.value);

  overlayObject.overlay = newOverlay;

  // Update border on selection
  newOverlay.on('select', () => {
    setOverlayBorder(newOverlay.getElement(), true);
    idSelectedOverlay.value = overlayObject.id;
  });

  newOverlay.on('deselect', () => {
    setOverlayBorder(newOverlay.getElement(), false);
    idSelectedOverlay.value = null;
  });

  // Explicitly disable keyboard handling on the overlay
  if (newOverlay.editing && newOverlay.editing._disableKeyboard) {
    newOverlay.editing._disableKeyboard();
  }

  const element = newOverlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return null;
  }

  L.DomEvent.on(element, 'load', () => {
    if (overlayObject.alreadyStored || overlayObject.alreadyLoaded) {
      (overlayObject.overlay as any).setCorners(overlayObject.history.at(-1));
    } else {
      // Save initial state to history
      const initialState = (overlayObject.overlay as any).getCorners();
      overlayObject.history = [initialState];
      overlayObject.redoStack = [];
    }

    if (!overlayObject.alreadyLoaded) {
      const marker = createMarker(overlayObject);
      if (marker) {
        overlayObject.marker = marker;
      }
    }

    overlayObject.alreadyLoaded = true;
    overlayObject.alreadyStored = true;
  });

  // Add event listeners for transformations
  newOverlay.on('edit', () => {
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
  });

  newOverlay.on('dragend', () => {
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
  });


  return newOverlay;
}

export function createMarker(overlayObject: overlayObject) {
  if (!map.value || !overlayObject.overlay) return null;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  const marker = L.marker(center).addTo(map.value);
  return marker;
}

export function updateMarkerPosition(overlayObject: overlayObject) {
  if (!overlayObject.overlay || !overlayObject.marker) return;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

export const SELECTED_OVERLAY_OUTLINE = '8px solid #ffffff';
export const SELECTED_OVERLAY_OUTLINE_OFFSET = '-8px';

export function setOverlayBorder(element: HTMLImageElement | undefined, isSelected: boolean) {
  if (!element) return;
  if (isSelected) {
    element.style.outline = SELECTED_OVERLAY_OUTLINE;
    element.style.outlineOffset = SELECTED_OVERLAY_OUTLINE_OFFSET;
  } else {
    element.style.outline = '';
    element.style.outlineOffset = '';
  }
}

export function saveToHistory(overlayObject: overlayObject) {
  if (!overlayObject.overlay) return;
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = [];
}

export function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  Object.values(overlays.value).forEach((overlayObject) => {
    const editing = (overlayObject.overlay as any).editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }

    const element = overlayObject.overlay?.getElement();
    if (element) {
      if (isEditMode.value) {
        element.style.boxShadow = SELECTED_OVERLAY_OUTLINE;
      } else {
        element.style.boxShadow = '';
      }
    }
  });
}