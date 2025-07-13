// AI : Import getConstructionMarkerColor from useCityMarkers for unified color logic
import { getConstructionMarkerColor } from '@composables/map/useCityMarkers';
import L from "leaflet";
import 'leaflet-toolbar'
import 'leaflet-distortableimage'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { shallowRef } from 'vue';
import { map } from '@composables/core/useMap';
import { overlays, idSelectedOverlay, isEditMode } from '@stores/overlayStore';
import { projects } from '@stores/projectStore';
import type { OverlayObject, CDNOverlayData } from '@types';

// AI : Simple type for overlay data used internally  
type StoredOverlayData = OverlayObject & {
  imageUrl: string;
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  isModified: boolean;
};
import { editTools, viewTools, infoTool } from '@composables/core/useTools';
import { router } from '../../router';
import { createColorIcon } from '@composables/ui/colorMarkers';

// AI : Export the reactive stores from centralized location
export { overlays, idSelectedOverlay, isEditMode };

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

/**
 * AI : Update overlay editing state based on current mode
 * AI : This function recreates overlays to update toolbar actions properly
 */
export function updateOverlayEditingState(): void {
  // AI : Store overlay data before recreating
  const overlayDataToRecreate: { [key: string]: { imageUrl: string; overlayObject: OverlayObject } } = {};
  
  Object.values(overlays.value).forEach(overlayObject => {
    if (!overlayObject.overlay) return;

    // AI : Store the overlay data for recreation
    overlayDataToRecreate[overlayObject.id] = {
      imageUrl: overlayObject.imageUrl,
      overlayObject: { ...overlayObject }
    };

    // AI : Remove the old overlay from the map
    if (map.value) {
      map.value.removeLayer(overlayObject.overlay);
    }
    
    // AI : Clear the overlay reference but keep the object
    overlayObject.overlay = null;
  });

  // AI : Recreate overlays with updated toolbar actions
  Object.entries(overlayDataToRecreate).forEach(async ([overlayId, data]) => {
    const overlayObject = overlays.value[overlayId];
    if (!overlayObject) return;

    // AI : Recreate the overlay with current mode's toolbar actions
    const newOverlay = await createOverlay(data.imageUrl, overlayObject);
    if (newOverlay) {
      overlayObject.overlay = newOverlay;
      
      // AI : Update marker color and tooltip
      updateMarkerTooltip(overlayObject);
    }
  });
}

/**
 * AI : Create a new overlay object from saved data
 */
export function createOverlayObject(savedOverlay: StoredOverlayData): OverlayObject {
  // AI : Provide default coordinates if missing
  const defaultLat = 50.8503; // AI : Brussels, Belgium
  const defaultLng = 4.3517;

  const coordinates = {
    topLeftLat: savedOverlay.topLeftLat ?? defaultLat - 0.001,
    topLeftLng: savedOverlay.topLeftLng ?? defaultLng - 0.001,
    topRightLat: savedOverlay.topRightLat ?? defaultLat - 0.001,
    topRightLng: savedOverlay.topRightLng ?? defaultLng + 0.001,
    bottomRightLat: savedOverlay.bottomRightLat ?? defaultLat + 0.001,
    bottomRightLng: savedOverlay.bottomRightLng ?? defaultLng + 0.001,
    bottomLeftLat: savedOverlay.bottomLeftLat ?? defaultLat + 0.001,
    bottomLeftLng: savedOverlay.bottomLeftLng ?? defaultLng - 0.001,
  };

  const project = savedOverlay.projectId ? projects.value[savedOverlay.projectId] : null;

  const corners = [
    { lat: coordinates.topLeftLat, lng: coordinates.topLeftLng },
    { lat: coordinates.topRightLat, lng: coordinates.topRightLng },
    { lat: coordinates.bottomRightLat, lng: coordinates.bottomRightLng },
    { lat: coordinates.bottomLeftLat, lng: coordinates.bottomLeftLng },
  ];

  return {
    ...savedOverlay,
    ...coordinates,
    overlay: null,
    marker: null,
    whitePixelsHidden: false,
    isFlipped: false,
    currentResolution: savedOverlay.imageUrl,
    corners,
    project: project ? { ...project, city: project.city ?? null } : null,
    isModified: false, // AI : Initialize as not modified
  };
}

/**
 * AI : Create a Leaflet overlay on the map
 */
export async function createOverlay(imageUrl: string, overlayObject?: OverlayObject) {
  console.log("Creating overlay with imageUrl:", imageUrl);
  if (!map.value || !overlayObject) return null;

  overlayObject.imageUrl ??= imageUrl;

  try {
    const newOverlay = L.distortableImageOverlay(imageUrl, {
      editable: true,
      keyboard: false,
      actions: [
        infoTool,
        ...(isEditMode.value ? editTools : viewTools)
      ],
    });

    newOverlay.addTo(map.value);
    overlayObject.overlay = newOverlay;

    setupOverlayEventHandlers(newOverlay, overlayObject);
    setupOverlayLoadHandler(newOverlay, overlayObject);

    // AI : Only disable editing if we're in view mode
    // AI : The onOverlayLoaded function will set the proper state when the element is ready
    if (!isEditMode.value) {
      // AI : Use a timeout to ensure element is available
      setTimeout(() => {
        const element = newOverlay.getElement();
        if (element) {
          disableOverlayEditing(newOverlay, element);
        }
      }, 100);
    }

    return newOverlay;
  } catch (error) {
    console.error('AI : Error creating overlay:', error);
    return null;
  }
}

/**
 * AI : Handle overlay load event with all initialization logic
 */
function setupOverlayLoadHandler(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  const element = overlay.getElement();
  if (!element) {
    setTimeout(() => setupOverlayLoadHandler(overlay, overlayObject), 100);
    return;
  }

  L.DomEvent.on(element, 'load', () => {
    if (element.complete && element.naturalWidth > 0) {
      onOverlayLoaded(overlayObject);
    }
  });

  if (element.complete && element.naturalWidth > 0) {
    setTimeout(() => onOverlayLoaded(overlayObject), 100);
  }
}

/**
 * AI : Handle all logic when overlay finishes loading
 */
function onOverlayLoaded(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  applyOverlayCorners(overlayObject);
  updateMarkerPosition(overlayObject);

  initializeOverlayHistory(overlayObject);

  // AI : Set proper editing state based on current mode
  const element = overlayObject.overlay.getElement();
  if (element) {
    if (isEditMode.value) {
      enableOverlayEditing(overlayObject.overlay, element);
    } else {
      disableOverlayEditing(overlayObject.overlay, element);
    }
  }

  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Initialize history for overlay if not already set
 */
function initializeOverlayHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;
  
  // AI : Only initialize if history is completely empty
  if (overlayObject.history.length > 0) {
    return;
  }

  const initialCorners = overlayObject.overlay.getCorners();
  if (initialCorners?.length === 4) {
    overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))];
    overlayObject.redoStack = [];
  }
}

function setupOverlayEventHandlers(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {

  overlay.on('select', () => {
    // AI : Simply update the selected overlay ID
    idSelectedOverlay.value = overlayObject.id;

    // AI : Apply selection outline
    applySelectionOutline(overlayObject);

    // AI : Update URL only, without moving the camera
    updateUrlWithOverlayId(overlayObject.id);
  });

  overlay.on('deselect', () => {
    idSelectedOverlay.value = null;

    // AI : Remove selection outline
    removeSelectionOutline(overlayObject);

    // AI : Clear overlay parameter from URL when deselected
    clearOverlayFromUrl();
  });
  
  overlay.on('edit', () => {
    // AI : Handle transition from backend to local copy when edited
    updateMarkerPosition(overlayObject);
    overlayObject.isModified = true;
    updateMarkerTooltip(overlayObject);
  });

  // AI : Set up comprehensive event handlers for overlay manipulation
  setupOverlayMovementTracking(overlay, overlayObject);
}

/**
 * AI : Updates the URL to use path parameter format for overlay selection
 * @param overlayId - The ID of the overlay to include in the URL
 */
function updateUrlWithOverlayId(overlayId: string): void {
  try {
    // Consistently use the globally exposed router
    if (!router) return;

    // AI : Update URL to use path parameter format /overlay/ID instead of query parameter
    router.replace(`/overlay/${overlayId}`);
  } catch (error) {
    console.error('AI: Error updating URL with overlay ID:', error);
  }
}

/**
 * AI : Removes the overlay path by navigating back to home
 */
function clearOverlayFromUrl(): void {
  try {
    // Consistently use the globally exposed router
    if (!router) return;

    // AI : Only navigate if we're on an overlay route
    const currentPath = router.currentRoute.value.path;
    if (currentPath.startsWith('/overlay/')) {
      router.replace('/');
    }
  } catch (error) {
    console.error('AI: Error clearing overlay from URL:', error);
  }
}

/**
 * AI : Applies corners to overlay with validation
 */
function applyOverlayCorners(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const element = overlayObject.overlay.getElement();
  if (!element?.complete || !element.naturalWidth) return;

  // AI : Check if overlay is ready for corner operations
  if (!(overlayObject.overlay as any)._corners) {
    setTimeout(() => applyOverlayCorners(overlayObject), 200);
    return;
  }

  const corners = getCornersForOverlay(overlayObject);
  if (corners && isValidCorners(corners)) {
    overlayObject.overlay.setCorners(corners);
  }
}

/**
 * AI : Get corners for overlay based on priority: history > coordinates > default
 */
function getCornersForOverlay(overlayObject: OverlayObject) {
  // AI : Priority 1: Use history if available
  if (overlayObject.history?.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners?.length === 4) return lastCorners;
  }

  // AI : Priority 2: Use individual lat/lng fields
  if (overlayObject.topLeftLat != null && overlayObject.topLeftLng != null) {
    return [
      { lat: overlayObject.topLeftLat, lng: overlayObject.topLeftLng },
      { lat: overlayObject.topRightLat, lng: overlayObject.topRightLng },
      { lat: overlayObject.bottomRightLat, lng: overlayObject.bottomRightLng },
      { lat: overlayObject.bottomLeftLat, lng: overlayObject.bottomLeftLng },
    ];
  }

  // AI : Priority 3: Initialize from current overlay state
  const currentCorners = overlayObject.overlay?.getCorners();
  if (currentCorners?.length === 4) {
    overlayObject.history = [JSON.parse(JSON.stringify(currentCorners))];
    overlayObject.redoStack = [];
    return currentCorners;
  }

  return null;
}

/**
 * AI : Validate corners data
 */
function isValidCorners(corners: any[]): boolean {
  return corners.every(corner =>
    corner &&
    typeof corner.lat === 'number' &&
    typeof corner.lng === 'number' &&
    !isNaN(corner.lat) &&
    !isNaN(corner.lng)
  );
}

/**
 * AI : Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.marker) {
    return;
  }

  // AI : Try different methods to get the center position
  let center: L.LatLng | null = null;
  
  // AI : Method 1: Try getBounds() if available
  if (overlayObject.overlay.getBounds) {
    const bounds = overlayObject.overlay.getBounds();
    if (bounds?.isValid()) {
      center = bounds.getCenter();
    }
  }
  
  // AI : Method 2: Try getCorners() if getBounds() fails
  if (!center) {
    try {
      const corners = overlayObject.overlay.getCorners();
      if (corners && corners.length === 4) {
        const latSum = corners.reduce((sum, corner) => sum + corner.lat, 0);
        const lngSum = corners.reduce((sum, corner) => sum + corner.lng, 0);
        center = L.latLng(latSum / 4, lngSum / 4);
      }
    } catch (error) {
      console.log('AI : updateMarkerPosition - getCorners failed:', error);
    }
  }
  
  // AI : Method 3: Fallback to element position
  if (!center) {
    try {
      const element = overlayObject.overlay.getElement();
      if (element) {
        const rect = element.getBoundingClientRect();
        const mapContainer = map.value?.getContainer();
        if (mapContainer) {
          const mapRect = mapContainer.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2 - mapRect.left;
          const centerY = rect.top + rect.height / 2 - mapRect.top;
          center = map.value?.containerPointToLatLng([centerX, centerY]) || null;
        }
      }
    } catch (error) {
      console.log('AI : updateMarkerPosition - Element position failed:', error);
    }
  }
  
  if (center) {
    overlayObject.marker.setLatLng(center);
  }
}

/**
 * AI : Save the current state of an overlay to history
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const currentState = overlayObject.overlay.getCorners();
  if (!currentState?.length) return;

  // AI : Check if current state is different from last saved state
  if (overlayObject.history.length > 0) {
    const lastState = overlayObject.history[overlayObject.history.length - 1];
    const currentStateStr = JSON.stringify(currentState);
    const lastStateStr = JSON.stringify(lastState);
    
    if (currentStateStr === lastStateStr) {
      return;
    }
  }

  overlayObject.history.push(JSON.parse(JSON.stringify(currentState)));
  overlayObject.redoStack = [];
  
  // AI : Mark overlay as modified when it's moved/changed
  overlayObject.isModified = true;
  
  updateMarkerTooltip(overlayObject);
}

// Event handler that blocks movement events but allows click events
function blockMovementEvent(e: Event) {
  const target = e.target as HTMLElement;
  const isToolbarClick = target.closest('.leaflet-toolbar-icon') !== null;

  if (isToolbarClick) {
    return true;
  }

  e.stopPropagation();
  // AI : Only call preventDefault if the event allows it (not passive)
  if (e.cancelable) {
    e.preventDefault();
  }
  return false;
}

/**
 * AI : Disable editing for an overlay
 * @param overlay - The overlay instance
 * @param element - The HTML element of the overlay
 */
function disableOverlayEditing(overlay: L.DistortableImageOverlay, element: HTMLElement): void {
  // Disable editing
  element.style.cursor = 'not-allowed';

  // We'll keep pointer-events enabled so clicks work, but block specific events
  // that would cause movement
  element.addEventListener('mousedown', blockMovementEvent, true);
  element.addEventListener('touchstart', blockMovementEvent, { capture: true, passive: true });
  element.addEventListener('dragstart', blockMovementEvent, true);

  if (overlay.off) {
    overlay.off('mousedown');
    overlay.off('touchstart');
    overlay.off('dragstart');
    overlay.off('drag');
    overlay.off('dragend');
    // Do NOT remove 'click' as we need it for toolbar
  }
}

/**
 * AI : Enable editing for an overlay
 */
function enableOverlayEditing(overlay: L.DistortableImageOverlay, element: HTMLElement): void {
  // AI : Remove disabled styling
  element.style.cursor = '';

  // AI : Remove event listeners that block editing
  element.removeEventListener('mousedown', blockMovementEvent, true);
  element.removeEventListener('touchstart', blockMovementEvent, { capture: true, passive: true } as any);
  element.removeEventListener('dragstart', blockMovementEvent, true);

  // AI : Make sure the overlay is editable
  (overlay as any).options.editable = true;
}

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  if (!map.value) return;

  Object.values(overlays.value).forEach((overlayObject) => {
    if (overlayObject.overlay) {
      map.value!.removeLayer(overlayObject.overlay);
    }
  });

  Object.values(allMarkers.value).forEach((marker) => {
    if (marker) {
      map.value!.removeLayer(marker);
    }
  });

  overlays.value = {};
  allMarkers.value = {};
  idSelectedOverlay.value = null;
}

/**
 * AI : Apply selection outline to overlay when selected
 */
function applySelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.projectId) return;

  const project = projects.value[overlayObject.projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlays.value).forEach(obj => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 20px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove selection outline from overlay when deselected
 */
function removeSelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.projectId) return;

  const project = projects.value[overlayObject.projectId];

  Object.values(overlays.value).forEach(obj => {
    if (obj.projectId === overlayObject.projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline for consistency
        element.style.boxShadow = project ? `0 0 0 2px ${project.color}` : '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Highlight all overlays from the same project on hover in view mode
 */
function highlightProjectOverlaysOnHover(projectId: string): void {
  if (!projectId || isEditMode.value) return;

  const project = projects.value[projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 20px ${color}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Remove project highlight on mouse leave in view mode
 */
function removeProjectHighlightOnHover(projectId: string): void {
  if (!projectId || isEditMode.value) return;

  const selectedOverlay = idSelectedOverlay.value ? overlays.value[idSelectedOverlay.value] : null;
  if (selectedOverlay?.projectId === projectId) return;

  const project = projects.value[projectId];

  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Use box-shadow instead of outline for consistency
        element.style.boxShadow = project ? `0 0 0 2px ${project.color}` : '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Setup hover event listeners for project highlighting in view mode
 */
function setupProjectHoverEvents(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  if (isEditMode.value || !overlayObject.projectId) return;

  const element = overlay.getElement();
  if (!element) return;

  element.addEventListener('mouseenter', () => {
    if (!isEditMode.value && overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  element.addEventListener('mouseleave', () => {
    if (!isEditMode.value && overlayObject.projectId) {
      removeProjectHighlightOnHover(overlayObject.projectId);
    }
  });
}

/**
 * AI : Render backend CDN overlays on the map for view mode
 */
export async function renderViewModeOverlays(cdnOverlays: CDNOverlayData[], createMarkers = true, forceRerender = false): Promise<void> {
  if (!map.value) return;

  let overlaysToRender: CDNOverlayData[];

  if (forceRerender) {
    // AI : Force re-render all overlays (for city switching)
    overlaysToRender = cdnOverlays;
  } else {
    // AI : Only render overlays that aren't already rendered
    const currentOverlayIds = new Set(Object.keys(overlays.value));
    overlaysToRender = cdnOverlays.filter(cdnOverlay => !currentOverlayIds.has(cdnOverlay.id));
  }

  for (const cdnOverlay of overlaysToRender) {
    await renderSingleViewModeOverlay(cdnOverlay, createMarkers);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 */
async function renderSingleViewModeOverlay(cdnOverlay: CDNOverlayData, createMarkers = true): Promise<void> {
  if (!map.value || overlays.value[cdnOverlay.id]) return;

  const corners = cdnOverlay.corners?.length === 4
    ? cdnOverlay.corners
    : [
      { lat: cdnOverlay.centroid.lat - 0.001, lng: cdnOverlay.centroid.lng - 0.001 },
      { lat: cdnOverlay.centroid.lat - 0.001, lng: cdnOverlay.centroid.lng + 0.001 },
      { lat: cdnOverlay.centroid.lat + 0.001, lng: cdnOverlay.centroid.lng + 0.001 },
      { lat: cdnOverlay.centroid.lat + 0.001, lng: cdnOverlay.centroid.lng - 0.001 }
    ];

  const cdnUrl = import.meta.env.VITE_CDN_URL ?? 'http://localhost:3000/uploads';
  const storedOverlayData: StoredOverlayData = {
    id: cdnOverlay.id,
    imageUrl: `${cdnUrl}/${cdnOverlay.filename}`,
    history: [],
    redoStack: [],
    projectId: cdnOverlay.projectId ?? '',
    caption: cdnOverlay.caption ?? null,
    filename: cdnOverlay.filename,
    metadata: null,
    createdAt: new Date(cdnOverlay.createdAt ?? Date.now()),
    updatedAt: new Date(),
    topLeftLat: corners[0].lat,
    topLeftLng: corners[0].lng,
    topRightLat: corners[1].lat,
    topRightLng: corners[1].lng,
    bottomRightLat: corners[2].lat,
    bottomRightLng: corners[2].lng,
    bottomLeftLat: corners[3].lat,
    bottomLeftLng: corners[3].lng,
    centroid: {
      x: cdnOverlay.centroid.lng,
      y: cdnOverlay.centroid.lat,
    },
    status: 'approved',
    authorId: null,
    overlay: null,
    marker: null,
    whitePixelsHidden: false,
    isFlipped: false,
    currentResolution: `${cdnUrl}/${cdnOverlay.filename}`,
    project: cdnOverlay.project,
    corners: corners,
    isModified: false, // AI : CDN overlays start as not modified
  };

  if (createMarkers) {
    createSingleMarker(storedOverlayData);
  }

  const overlayObject = createOverlayObject(storedOverlayData);
  const newOverlay = await createOverlay(overlayObject.imageUrl, overlayObject);
  if (!newOverlay) return;

  overlayObject.overlay = newOverlay;
  overlayObject.marker = allMarkers.value[cdnOverlay.id];
  overlays.value[cdnOverlay.id] = overlayObject;

  if (cdnOverlay.project) {
    overlayObject.project = cdnOverlay.project;
  }

  if (overlayObject.overlay) {
    setupProjectHoverEvents(overlayObject.overlay, overlayObject);
  }

  // AI : Update marker tooltip with correct overlay object information
  if (overlayObject.marker) {
    updateMarkerTooltip(overlayObject);
  }
}

/**
 * AI : Remove a specific overlay from the map and collections
 */
export function removeOverlay(overlayId: string): void {
  if (!map.value) return;

  const overlayObject = overlays.value[overlayId];
  if (!overlayObject) return;

  if (overlayObject.overlay) {
    map.value.removeLayer(overlayObject.overlay);
  }

  if (overlayObject.marker) {
    map.value.removeLayer(overlayObject.marker);
  }

  delete overlays.value[overlayId];
  delete allMarkers.value[overlayId];

  if (idSelectedOverlay.value === overlayId) {
    idSelectedOverlay.value = null;
  }
}

/**
 * AI : Update marker tooltip based on overlay storage status
 */
export function updateMarkerTooltip(overlayObject: OverlayObject): void {
  if (!overlayObject.marker) return;

  overlayObject.marker.unbindTooltip();

  const markerColor = getMarkerColorForStorageStatus(overlayObject);
  const colorIcon = createColorIcon(markerColor);
  overlayObject.marker.setIcon(colorIcon);

  if (isEditMode.value) {
    // AI : Generate tooltip text based on overlay state
    const isRemoteOverlay = overlayObject.project !== undefined;
    const hasBeenModified = overlayObject.isModified;
    
    let tooltipText = '';
    if (isRemoteOverlay && !hasBeenModified) {
      tooltipText = 'Saved remotely';
    } else if (isRemoteOverlay && hasBeenModified) {
      tooltipText = 'Remote overlay (modified)';
    } else if (!isRemoteOverlay && hasBeenModified) {
      tooltipText = 'Local overlay';
    } else {
      tooltipText = 'New overlay';
    }

    overlayObject.marker.bindTooltip(tooltipText, {
      permanent: false,
      direction: 'top',
      offset: [0, -10]
    });
  }
}

/**
 * AI : Determine marker color based on mode and status
 */
function getMarkerColorForStorageStatus(overlayObject: OverlayObject): 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black' {
  if (isEditMode.value) {
    // AI : In edit mode, show different colors based on overlay state
    
    // AI : Check if overlay was loaded from CDN (has project data from backend)
    const isRemoteOverlay = overlayObject.project !== undefined;
    
    // AI : Check if overlay has been modified locally
    const hasBeenModified = overlayObject.isModified;
    
    if (isRemoteOverlay && !hasBeenModified) {
      // AI : Remote overlay, not modified = green
      return 'green';
    } else if (isRemoteOverlay && hasBeenModified) {
      // AI : Remote overlay, modified locally = orange
      return 'orange';
    } else if (!isRemoteOverlay && hasBeenModified) {
      // AI : Local overlay with changes = red
      return 'red';
    } else {
      // AI : New overlay, no changes = blue
      return 'blue';
    }
  }

  // AI : View mode - use construction timeline colors
  let startDate: string | Date | null | undefined = null;
  let endDate: string | Date | null | undefined = null;
  if (overlayObject.project) {
    startDate = overlayObject.project.startDate;
    endDate = overlayObject.project.endDate;
  } else if ((overlayObject as any).startDate || (overlayObject as any).endDate) {
    startDate = (overlayObject as any).startDate;
    endDate = (overlayObject as any).endDate;
  }
  return getConstructionMarkerColor(startDate, endDate);
}

/**
 * AI : Create a single marker for an overlay
 */
function createSingleMarker(savedOverlay: StoredOverlayData): void {
  if (!map.value || allMarkers.value[savedOverlay.id]) return;

  const overlayBounds = getOverlayBounds(savedOverlay);
  if (!overlayBounds) return;

  let markerTitle = 'Overlay';
  if (savedOverlay.projectId && projects.value[savedOverlay.projectId]) {
    const project = projects.value[savedOverlay.projectId];
    const captionPart = savedOverlay.caption ? ` - ${savedOverlay.caption}` : '';
    markerTitle = `${project.name}${captionPart}`;
  }

  const center = overlayBounds.getCenter();

  const tempOverlayObject = createOverlayObject(savedOverlay);
  const markerColor = getMarkerColorForStorageStatus(tempOverlayObject);
  const colorIcon = createColorIcon(markerColor);

  const marker = L.marker(center, {
    title: markerTitle,
    icon: colorIcon
  }).addTo(map.value!);

  allMarkers.value[savedOverlay.id] = marker;

  tempOverlayObject.marker = marker;
  updateMarkerTooltip(tempOverlayObject);
}

function getOverlayBounds(overlay: StoredOverlayData): L.LatLngBounds | null {
  // AI : Validate all corner coordinates exist and are valid numbers
  if (!overlay.topLeftLat || !overlay.topLeftLng ||
    !overlay.topRightLat || !overlay.topRightLng ||
    !overlay.bottomRightLat || !overlay.bottomRightLng ||
    !overlay.bottomLeftLat || !overlay.bottomLeftLng) {
    console.warn('AI : Invalid overlay coordinates for overlay:', overlay.id);
    return null;
  }

  const corners = [
    L.latLng(overlay.topLeftLat, overlay.topLeftLng),
    L.latLng(overlay.topRightLat, overlay.topRightLng),
    L.latLng(overlay.bottomRightLat, overlay.bottomRightLng),
    L.latLng(overlay.bottomLeftLat, overlay.bottomLeftLng),
  ];

  // AI : Check if all corners are valid
  if (corners.some(c => !c.lat || !c.lng)) {
    return null;
  }

  return L.latLngBounds(corners);
}

/**
 * AI : Set up comprehensive movement tracking for overlays
 */
function setupOverlayMovementTracking(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  // AI : Track all overlay manipulation events
  overlay.on('edit', () => {
    updateMarkerPosition(overlayObject);
  });
  
  // AI : Set up DOM event listeners for additional tracking
  setTimeout(() => {
    const element = overlay.getElement();
    if (element) {
      let isManipulating = false;
      let updateFrame: number | null = null;
      let lastSavedState: any = null;
      
      const startTracking = () => {
        if (isManipulating) return;
        
        // AI : Always save current state before manipulation starts
        const currentCorners = overlayObject.overlay?.getCorners();
        if (currentCorners && currentCorners.length === 4) {
          const currentStateStr = JSON.stringify(currentCorners);
          
          // AI : If history is empty, initialize it with current state
          if (overlayObject.history.length === 0) {
            overlayObject.history = [JSON.parse(JSON.stringify(currentCorners))];
            overlayObject.redoStack = [];
            lastSavedState = currentStateStr;
          } else {
            // AI : Save current state to history if it's different from last saved
            if (lastSavedState !== currentStateStr) {
              saveToHistory(overlayObject);
              lastSavedState = currentStateStr;
            }
          }
        }
        
        isManipulating = true;
        
        const continuousUpdate = () => {
          if (isManipulating) {
            updateMarkerPosition(overlayObject);
            updateFrame = requestAnimationFrame(continuousUpdate);
          }
        };
        continuousUpdate();
      };
      
      const stopTracking = () => {
        if (!isManipulating) return;
        isManipulating = false;
        
        if (updateFrame) {
          cancelAnimationFrame(updateFrame);
          updateFrame = null;
        }
        
        // AI : Final update after manipulation ends
        updateMarkerPosition(overlayObject);
        
        // AI : Save the final state after manipulation ends
        const finalCorners = overlayObject.overlay?.getCorners();
        if (finalCorners && finalCorners.length === 4) {
          const finalStateStr = JSON.stringify(finalCorners);
          if (lastSavedState !== finalStateStr) {
            saveToHistory(overlayObject);
            lastSavedState = finalStateStr;
          }
        }
      };
      
      // AI : Track mouse and touch events
      element.addEventListener('mousedown', startTracking);
      element.addEventListener('touchstart', startTracking, { passive: true });
      
      document.addEventListener('mouseup', stopTracking);
      document.addEventListener('touchend', stopTracking);
      document.addEventListener('mousemove', () => {
        if (isManipulating) {
          updateMarkerPosition(overlayObject);
        }
      });
      document.addEventListener('touchmove', () => {
        if (isManipulating) {
          updateMarkerPosition(overlayObject);
        }
      }, { passive: true });
    }
  }, 100);
}


