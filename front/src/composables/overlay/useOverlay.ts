// AI : Import getConstructionMarkerColor from useCityMarkers for unified color logic
import { getConstructionMarkerColor } from '@composables/map/useCityMarkers';
import L from "leaflet";
import 'leaflet-toolbar'
import 'leaflet-distortableimage'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { shallowRef } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { saveOverlay } from '@composables/core/useDatabase';
import { overlays, idSelectedOverlay, isEditMode } from '@stores/overlayStore';
import { projects } from '@stores/projectStore';
import type { OverlayObject, StoredOverlayData, CDNOverlayData } from '@types';
import { editTools, viewTools, infoTool } from '@composables/core/useTools';
import { router } from '../../router';
import { createColorIcon } from '@composables/ui/colorMarkers';

// AI : Export the reactive stores from centralized location
export { overlays, idSelectedOverlay, isEditMode };

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

// AI : Save an individual overlay to local storage
// This is called explicitly when an overlay changes, rather than watching the entire collection
// Remote overlays are saved locally when they have been modified 
export function saveOverlayToDatabase(overlayObj: OverlayObject): void {
  if (!overlayObj?.alreadyLoaded) return;

  // AI : Skip saving remote overlays that haven't been modified locally
  if (overlayObj.savedRemotely && !overlayObj.alreadyStored) return;

  if (!overlayObj.alreadyStored) return;

  const corners = overlayObj.overlay?.getCorners() ?? [];
  const savedOverlay: StoredOverlayData = {
    // AI : Copy only serializable properties, excluding overlay, marker, and project objects
    id: overlayObj.id,
    imageUrl: overlayObj.imageUrl,
    history: overlayObj.history,
    redoStack: overlayObj.redoStack,
    projectId: overlayObj.projectId,
    caption: overlayObj.caption,
    savedRemotely: overlayObj.savedRemotely,
    metadata: overlayObj.metadata,
    createdAt: overlayObj.createdAt,
    status: overlayObj.status,
    authorId: overlayObj.authorId,
    // AI : Required fields from Drizzle schema
    filename: overlayObj.filename ?? overlayObj.imageUrl.split('/').pop() ?? '',
    // AI : Map corners to individual lat/lng fields
    topLeftLat: corners[0]?.lat ?? 0,
    topLeftLng: corners[0]?.lng ?? 0,
    topRightLat: corners[1]?.lat ?? 0,
    topRightLng: corners[1]?.lng ?? 0,
    bottomRightLat: corners[2]?.lat ?? 0,
    bottomRightLng: corners[2]?.lng ?? 0,
    bottomLeftLat: corners[3]?.lat ?? 0,
    bottomLeftLng: corners[3]?.lng ?? 0,
    centroid: {
      x: overlayObj.overlay?.getBounds().getCenter().lng ?? 0,
      y: overlayObj.overlay?.getBounds().getCenter().lat ?? 0,
    },
    updatedAt: new Date(),
  };

  try {
    // AI : Save locally during editing, not to backend
    saveOverlay(savedOverlay);
    // AI : Update storage status and marker tooltip
    overlayObj.alreadyStored = true;
    updateMarkerTooltip(overlayObj);
  } catch (error) {
    console.error('AI : Error saving overlay to local storage:', error);
  }
}

/**
 * AI : Initialize overlays from database and set up event handlers
 * In edit mode: loads from local IndexedDB only, in view mode: handled by useViewModeOverlays
 */
export async function initializeOverlays(): Promise<void> {
  if (!map.value) return;

  // AI : In view mode, skip local database entirely
  if (!isEditMode.value) {
    setupMapEventListeners();
    return;
  }

  // AI : In edit mode, no overlays to load from local database (empty array)
  const savedOverlays: StoredOverlayData[] = [];

  const mapBounds = map.value.getBounds();

  // AI : Only create markers in edit mode - view mode markers are handled by renderViewModeOverlays
  if (isEditMode.value) {
    createMarkersForOverlays(savedOverlays);
  }
  loadOverlaysInMapBounds(savedOverlays, mapBounds);

  setupMapEventListeners();

  onMapInitialized(() => {
  });
}

function setupMapEventListeners(): void {
  if (!map.value) return;

  map.value.on('moveend', loadOverlaysInView);
  
  // AI : Add zoom event listener to handle loading overlays when zoom changes in edit mode
  map.value.on('zoomend', () => {
    if (isEditMode.value) {
      loadOverlaysInView();
    }
  });
}

function createMarkersForOverlays(savedOverlays: StoredOverlayData[]): void {
  if (!map.value) return;

  // AI : Use unified marker creation for LOCAL overlays only (not remote)
  savedOverlays.forEach(savedOverlay => {
    if (!savedOverlay.savedRemotely) {
      createSingleMarker(savedOverlay);
    }
  });
}

function loadOverlaysInMapBounds(savedOverlays: StoredOverlayData[], mapBounds: L.LatLngBounds): void {
  savedOverlays.forEach(async (savedOverlay) => {
    if (isOverlayWithinBounds(savedOverlay, mapBounds)) {
      // AI : In edit mode, check zoom level before loading full overlay
      if (isEditMode.value) {
        const currentZoom = map.value?.getZoom() ?? 0;
        if (currentZoom < 12) {
          // AI : Only create/update marker, don't load full overlay
          if (!overlays.value[savedOverlay.id]) {
            const overlayObject = createOverlayObject(savedOverlay);
            overlays.value[savedOverlay.id] = overlayObject;
          }
          return;
        }
      }
      await loadOverlay(savedOverlay);
    }
  });
}

async function loadOverlay(savedOverlay: StoredOverlayData): Promise<void> {
  const overlayObject = createOverlayObject(savedOverlay);

  const overlayBounds = getOverlayBounds(savedOverlay);
  if (!overlayBounds || !map.value) return;

  const imageUrl = savedOverlay.imageUrl;

  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  overlayObject.overlay = newOverlay;
  
  // AI : Always assign markers from allMarkers if they exist
  overlayObject.marker = allMarkers.value[savedOverlay.id];
  
  overlays.value[savedOverlay.id] = overlayObject;

  // AI : Update marker tooltip with correct overlay object information
  if (overlayObject.marker) {
    updateMarkerTooltip(overlayObject);
  }
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

function isOverlayWithinBounds(overlay: StoredOverlayData, bounds: L.LatLngBounds): boolean {
  const overlayBounds = getOverlayBounds(overlay);
  if (!overlayBounds) return true; // AI : If no bounds, assume it's within view to load it

  return bounds.intersects(overlayBounds);
}

async function loadOverlaysInView(): Promise<void> {
  // AI : Only load overlays in edit mode
  if (!isEditMode.value) return;

  if (!map.value) return;

  const currentBounds = map.value.getBounds();
  const currentZoom = map.value.getZoom();
  const savedOverlays: StoredOverlayData[] = []; // AI : No overlays to load from local database

  savedOverlays.forEach(async (savedOverlay) => {
    const isAlreadyLoaded = overlays.value[savedOverlay.id] !== undefined;

    if (!isAlreadyLoaded && isOverlayWithinBounds(savedOverlay, currentBounds)) {
      if (currentZoom < 12) {
        // AI : Only create overlay object without loading full image
        const overlayObject = createOverlayObject(savedOverlay);
        overlays.value[savedOverlay.id] = overlayObject;
      } else {
        // AI : Load full overlay when zoom is sufficient
        await loadOverlay(savedOverlay);
      }
    } else if (isAlreadyLoaded) {
      // AI : Handle zoom-based loading for already tracked overlays
      const overlayObject = overlays.value[savedOverlay.id];
      if (currentZoom >= 12 && !overlayObject.overlay) {
        // AI : Load full overlay when zoom becomes sufficient
        await loadOverlay(savedOverlay);
      } else if (currentZoom < 12 && overlayObject.overlay) {
        // AI : Hide full overlay when zoom becomes insufficient
        if (map.value) {
          try {
            map.value.removeLayer(overlayObject.overlay);
            overlayObject.overlay = null;
          } catch (error) {
            console.warn(`AI : Error removing overlay on zoom out:`, error);
          }
        }
      }
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
    alreadyLoaded: false,
    alreadyStored: !savedOverlay.savedRemotely || (savedOverlay.history?.length > 0),
    whitePixelsHidden: false,
    isFlipped: false,
    currentResolution: savedOverlay.imageUrl,
    savedRemotely: savedOverlay.savedRemotely ?? false,
    corners,
    project: project ? { ...project, city: project.city ?? null } : null,
  };
}

/**
 * AI : Create a Leaflet overlay on the map
 */
export async function createOverlay(imageUrl: string, overlayObject?: OverlayObject) {
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

    if (!isEditMode.value) {
      const element = newOverlay.getElement();
      if (element) {
        disableOverlayEditing(newOverlay, element);
      }
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
  overlayObject.alreadyLoaded = true;

  initializeOverlayHistory(overlayObject);
  handleOverlayStorageOnLoad(overlayObject);
  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Initialize history for overlay if not already set
 */
function initializeOverlayHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || overlayObject.history.length > 0) return;

  const initialCorners = overlayObject.overlay.getCorners();
  if (initialCorners?.length === 4) {
    overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))];
    overlayObject.redoStack = [];
  }
}

/**
 * AI : Handle storage logic when overlay loads
 */
function handleOverlayStorageOnLoad(overlayObject: OverlayObject): void {
  // AI : Don't automatically set alreadyStored = true for remote overlays in view mode
  if (!overlayObject.savedRemotely) {
    overlayObject.alreadyStored = true;
  }

  // AI : Save to database in edit mode for new local overlays only
  if (isEditMode.value && !overlayObject.savedRemotely) {
    saveOverlayToDatabase(overlayObject);
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
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
  });

  overlay.on('dragend', () => {
    // AI : Handle transition from backend to local copy when moved
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
  });
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
  if (!overlayObject.overlay?.getBounds || !overlayObject.marker) return;
  
  const bounds = overlayObject.overlay.getBounds();
  if (bounds?.isValid()) {
    overlayObject.marker.setLatLng(bounds.getCenter());
  }
}

/**
 * AI : Save the current state of an overlay to history and local storage
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const currentState = overlayObject.overlay.getCorners();
  if (!currentState?.length) return;

  overlayObject.history.push(JSON.parse(JSON.stringify(currentState)));
  overlayObject.redoStack = [];

  const savedOverlay = createStoredOverlayData(overlayObject, currentState);
  saveOverlay(savedOverlay);
  overlayObject.alreadyStored = true;
  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Create StoredOverlayData from overlay object and corners
 */
function createStoredOverlayData(overlayObject: OverlayObject, corners: any[]): StoredOverlayData {
  return {
    id: overlayObject.id,
    imageUrl: overlayObject.imageUrl,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    projectId: overlayObject.projectId,
    caption: overlayObject.caption,
    savedRemotely: overlayObject.savedRemotely,
    filename: overlayObject.filename,
    metadata: overlayObject.metadata,
    createdAt: overlayObject.createdAt,
    status: overlayObject.status,
    authorId: overlayObject.authorId,
    topLeftLat: corners[0]?.lat ?? 0,
    topLeftLng: corners[0]?.lng ?? 0,
    topRightLat: corners[1]?.lat ?? 0,
    topRightLng: corners[1]?.lng ?? 0,
    bottomRightLat: corners[2]?.lat ?? 0,
    bottomRightLng: corners[2]?.lng ?? 0,
    bottomLeftLat: corners[3]?.lat ?? 0,
    bottomLeftLng: corners[3]?.lng ?? 0,
    centroid: {
      x: overlayObject.overlay?.getBounds().getCenter().lng ?? 0,
      y: overlayObject.overlay?.getBounds().getCenter().lat ?? 0,
    },
    updatedAt: new Date(),
  };
}

/**
 * AI : Toggle edit mode for all overlays with proper cleanup
 */
export async function toggleEditMode(): Promise<void> {
  isEditMode.value = !isEditMode.value;
  clearAllOverlays();

  if (isEditMode.value) {
    await initializeOverlays();
  }

  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.marker) {
      updateMarkerTooltip(overlayObject);
    }
  });
}

// Event handler that blocks movement events but allows click events
function blockMovementEvent(e: Event) {
  const target = e.target as HTMLElement;
  const isToolbarClick = target.closest('.leaflet-toolbar-icon') !== null;

  if (isToolbarClick) {
    return true;
  }

  e.stopPropagation();
  e.preventDefault();
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
  element.addEventListener('touchstart', blockMovementEvent, { capture: true, passive: false });
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
 * AI : Load a specific overlay by ID from the database
 */
export async function loadOverlayById(id: string): Promise<void> {
  if (!isEditMode.value || !map.value) return;

  console.warn(`AI : Overlay with ID ${id} not found - no local database`);
}

/**
 * AI : Update an overlay's image without recreating the overlay
 */
export function updateOverlayImage(overlayObject: OverlayObject, newImageUrl: string): void {
  if (!overlayObject.overlay) return;

  const currentCorners = overlayObject.overlay.getCorners();
  
  const preloadImg = new Image();
  preloadImg.onload = () => {
    if (!overlayObject.overlay) return;
    
    if (typeof overlayObject.overlay.setUrl === 'function') {
      overlayObject.overlay.setUrl(newImageUrl);
    } else {
      const imgElement = overlayObject.overlay.getElement();
      if (imgElement) imgElement.src = newImageUrl;
    }
    
    overlayObject.currentResolution = newImageUrl;
    
    if (currentCorners) {
      overlayObject.overlay.setCorners(currentCorners);
    }
  };
  
  preloadImg.src = newImageUrl;
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
        element.style.outline = `30px solid ${color}`;
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
        element.style.outline = project ? `4px solid ${project.color}` : '';
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
        element.style.outline = `30px solid ${color}`;
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
        element.style.outline = project ? `4px solid ${project.color}` : '';
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
    savedRemotely: true,
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
  };

  if (createMarkers) {
    createSingleMarker(storedOverlayData);
  }

  await loadOverlay(storedOverlayData);
  
  const overlayObject = overlays.value[cdnOverlay.id];
  if (overlayObject) {
    if (cdnOverlay.project) {
      overlayObject.project = cdnOverlay.project;
    }

    if (overlayObject.overlay) {
      setupProjectHoverEvents(overlayObject.overlay, overlayObject);
    }
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
    const tooltipText = overlayObject.alreadyStored
      ? 'Stored locally in IndexedDB'
      : 'Remote overlay (not stored locally)';

    overlayObject.marker.bindTooltip(tooltipText, {
      permanent: false,
      direction: 'top',
      offset: [0, -10]
    });
  }
}

/**
 * AI : Check if overlay exists in local IndexedDB and update tooltip accordingly
 */
export async function checkAndUpdateOverlayStorageStatus(overlayObject: OverlayObject): Promise<void> {
  if (!overlayObject.marker) return;

  overlayObject.alreadyStored = false;
  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Determine marker color based on mode and status
 */
function getMarkerColorForStorageStatus(overlayObject: OverlayObject): 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black' {
  if (isEditMode.value) {
    const { savedRemotely, alreadyStored } = overlayObject;

    if (savedRemotely && !alreadyStored) {
      return 'green';
    } else if (savedRemotely && alreadyStored) {
      return 'orange';
    } else if (!savedRemotely && alreadyStored) {
      return 'red';
    }

    return 'blue';
  }

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
