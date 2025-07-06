import L from "leaflet";
import 'leaflet-toolbar'
import 'leaflet-distortableimage'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { shallowRef } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { getAllOverlays, saveOverlay } from '@composables/core/useDatabase';
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

// AI : Save an individual overlay to the database
// This is called explicitly when an overlay changes, rather than watching the entire collection
// Remote overlays are only saved if they have been modified (alreadyStored will be true after editing)
export function saveOverlayToDatabase(overlayObj: OverlayObject): void {
  if (!overlayObj?.alreadyLoaded) return;

  // AI : Skip saving remote overlays that haven't been modified locally
  if (overlayObj.savedRemotely && !overlayObj.alreadyStored) return;

  if (!overlayObj.alreadyStored) return;

  const savedOverlay: StoredOverlayData = {
    id: overlayObj.id,
    imageUrl: overlayObj.imageUrl,
    corners: overlayObj.corners,
    history: overlayObj.history,
    redoStack: overlayObj.redoStack,
    projectId: overlayObj.projectId,
    caption: overlayObj.caption,
    savedRemotely: overlayObj.savedRemotely || false
  };

  saveOverlay(savedOverlay);

  // AI : Update storage status and marker tooltip
  overlayObj.alreadyStored = true;
  updateMarkerTooltip(overlayObj);
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

  // AI : In edit mode, load only from local database
  const savedOverlays = await getAllOverlays();

  const mapBounds = map.value.getBounds();

  createMarkersForOverlays(savedOverlays);
  loadOverlaysInMapBounds(savedOverlays, mapBounds);

  setupMapEventListeners();

  onMapInitialized(() => {
  });
}

function setupMapEventListeners(): void {
  if (!map.value) return;

  map.value.on('moveend', loadOverlaysInView);
}

function createMarkersForOverlays(savedOverlays: StoredOverlayData[]): void {
  if (!map.value) return;

  savedOverlays.forEach(savedOverlay => {
    const overlayBounds = getOverlayBounds(savedOverlay);
    if (!overlayBounds || allMarkers.value[savedOverlay.id]) return;

    let markerTitle = 'Overlay';
    if (savedOverlay.projectId && projects.value[savedOverlay.projectId]) {
      const project = projects.value[savedOverlay.projectId];
      const captionPart = savedOverlay.caption ? ` - ${savedOverlay.caption}` : '';
      markerTitle = `${project.name}${captionPart}`;
    }

    const center = overlayBounds.getCenter();

    // AI : Create a temporary overlay object to determine correct marker color
    const tempOverlayObject = createOverlayObject(savedOverlay);
    const markerColor = getMarkerColorForStorageStatus(tempOverlayObject);
    const colorIcon = createColorIcon(markerColor);

    const marker = L.marker(center, {
      title: markerTitle,
      icon: colorIcon
    }).addTo(map.value!);

    allMarkers.value[savedOverlay.id] = marker;

    // AI : Assign marker to temp object and update tooltip
    tempOverlayObject.marker = marker;
    updateMarkerTooltip(tempOverlayObject);
  });
}

function loadOverlaysInMapBounds(savedOverlays: StoredOverlayData[], mapBounds: L.LatLngBounds): void {
  savedOverlays.forEach(async (savedOverlay) => {
    if (isOverlayWithinBounds(savedOverlay, mapBounds)) {
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
  overlayObject.marker = allMarkers.value[savedOverlay.id];
  overlays.value[savedOverlay.id] = overlayObject;

  // AI : Update marker tooltip with correct overlay object information
  if (overlayObject.marker) {
    updateMarkerTooltip(overlayObject);
  }
}

function getOverlayBounds(overlay: StoredOverlayData): L.LatLngBounds | null {
  if (!overlay.corners || overlay.corners.length < 2) {
    return null;
  }

  return L.latLngBounds(
    overlay.corners.map(corner => L.latLng(corner.lat, corner.lng))
  );
}

function isOverlayWithinBounds(overlay: StoredOverlayData, bounds: L.LatLngBounds): boolean {
  if (!overlay.corners || overlay.corners.length === 0) return true;

  const overlayBounds = getOverlayBounds(overlay);
  if (!overlayBounds) return true;

  return bounds.intersects(overlayBounds);
}

async function loadOverlaysInView(): Promise<void> {
  // AI : Only load overlays in edit mode
  if (!isEditMode.value) return;

  if (!map.value) return;

  const currentBounds = map.value.getBounds();
  const savedOverlays = await getAllOverlays();

  savedOverlays.forEach(async (savedOverlay) => {
    const isAlreadyLoaded = overlays.value[savedOverlay.id] !== undefined;

    if (!isAlreadyLoaded && isOverlayWithinBounds(savedOverlay, currentBounds)) {
      await loadOverlay(savedOverlay);
    }
  });
}


/**
 * AI : Create a new overlay object from saved data
 */
export function createOverlayObject(savedOverlay: StoredOverlayData): OverlayObject {
  // AI : Get project data from local projects collection if available
  const projectData = savedOverlay.projectId && projects.value[savedOverlay.projectId]
    ? {
      id: projects.value[savedOverlay.projectId].id,
      title: projects.value[savedOverlay.projectId].name,
      description: projects.value[savedOverlay.projectId].description ?? null,
      metadata: { color: projects.value[savedOverlay.projectId].color },
      createdAt: new Date(projects.value[savedOverlay.projectId].createdAt),
      updatedAt: new Date(projects.value[savedOverlay.projectId].updatedAt)
    }
    : null;

  const overlayObject = {
    ...savedOverlay,
    overlay: null,
    marker: null,
    alreadyLoaded: false,
    // AI : Only mark as stored if it's a local overlay OR a remote overlay that has been modified
    // Remote overlays that exist in IndexedDB but were never modified should not be considered "stored"
    alreadyStored: !savedOverlay.savedRemotely || (savedOverlay.history && savedOverlay.history.length > 0),
    whitePixelsHidden: false,
    isFlipped: false, // AI : Initialize as not flipped
    currentResolution: savedOverlay.imageUrl,
    savedRemotely: savedOverlay.savedRemotely || false, // AI : Default to false if not set
    project: projectData // AI : Include project data for InfoPopup display, will be updated from backend if needed
  };
  return overlayObject;
}

/**
 * AI : Create a Leaflet overlay on the map
 */
export async function createOverlay(imageUrl: string, overlayObject?: OverlayObject) {
  if (!map.value || !overlayObject) return null;

  if (!overlayObject.imageUrl) {
    overlayObject.imageUrl = imageUrl;
  }

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
}

/**
 * AI : Handle overlay load event with all initialization logic
 */
function setupOverlayLoadHandler(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  const element = overlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return;
  }

  // AI : using 'element' allows to access the corners of the image on load while overlay.on('load') doesn't work
  // credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228
  L.DomEvent.on(element, 'load', () => {
    onOverlayLoaded(overlayObject);
  });
}

/**
 * AI : Handle all logic when overlay finishes loading
 */
function onOverlayLoaded(overlayObject: OverlayObject): void {
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
  if (initialCorners && initialCorners.length > 0) {
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
    overlayObject.corners = overlay.getCorners();
  });

  overlay.on('dragend', () => {
    // AI : Handle transition from backend to local copy when moved
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.corners = overlay.getCorners();
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
 * AI : Applies the correct corners to an overlay based on priority
 */
function applyOverlayCorners(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;
  // Priority 1: Use corners directly if available
  if (overlayObject.corners && overlayObject.corners.length === 4) {
    overlayObject.overlay.setCorners(overlayObject.corners);
  }
  // Priority 2: Use history if available
  else if ((overlayObject.alreadyStored || overlayObject.alreadyLoaded) &&
    overlayObject.history && overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners) {
      overlayObject.overlay.setCorners(lastCorners);
    }
  }  // Priority 3: Create new history for new overlay with deep copy
  else {
    const initialState = overlayObject.overlay.getCorners();
    if (initialState && initialState.length > 0) {
      overlayObject.history = [JSON.parse(JSON.stringify(initialState))];
      overlayObject.redoStack = [];
    }
  }
}

/**
 * AI : Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.marker) return;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

/**
 * AI : Save the current state of an overlay to history and database
 * Remote overlays are saved here when edited/moved (this is the intended behavior)
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = [];

  overlayObject.corners = overlayObject.overlay.getCorners();

  const savedOverlay: StoredOverlayData = {
    id: overlayObject.id,
    imageUrl: overlayObject.imageUrl,
    corners: overlayObject.corners,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    projectId: overlayObject.projectId,
    caption: overlayObject.caption,
    savedRemotely: overlayObject.savedRemotely || false // AI : Include server existence tracking
  };

  saveOverlay(savedOverlay);

  // AI : Update storage status and marker tooltip - remote overlays become locally stored when edited
  overlayObject.alreadyStored = true;
  updateMarkerTooltip(overlayObject);
}

/**
 * AI : Toggle edit mode for all overlays with proper cleanup
 */
export async function toggleEditMode(): Promise<void> {

  isEditMode.value = !isEditMode.value;

  // AI : Clear all current overlays when switching modes
  clearAllOverlays();

  if (isEditMode.value) {
    await initializeOverlays();
  }

  // AI : Update all existing marker tooltips for the new mode
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
  element.addEventListener('touchstart', blockMovementEvent, true);
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
  // AI : Only load overlays in edit mode
  if (!isEditMode.value) return;

  if (!map.value) return;

  const allOverlays = await getAllOverlays();
  const savedOverlay = allOverlays.find(overlay => overlay.id === id);

  if (!savedOverlay) {
    console.error(`Overlay with ID ${id} not found in database`);
    return;
  }

  await loadOverlay(savedOverlay);
}

/**
 * AI : Update an overlay's image without recreating the overlay
 */
export function updateOverlayImage(overlayObject: OverlayObject, newImageUrl: string): void {
  if (!overlayObject.overlay) return;

  const currentCorners = overlayObject.overlay.getCorners();
  
  // AI : Preload image to avoid flickering
  const preloadImg = new Image();
  preloadImg.onload = () => {
    if (!overlayObject.overlay) return;
    
    // AI : Try setUrl method first, fall back to direct DOM manipulation
    if (typeof overlayObject.overlay.setUrl === 'function') {
      overlayObject.overlay.setUrl(newImageUrl);
    } else {
      const imgElement = overlayObject.overlay.getElement();
      if (imgElement) imgElement.src = newImageUrl;
    }
    
    overlayObject.currentResolution = newImageUrl;
    
    // AI : Restore corners after image update
    if (currentCorners) {
      overlayObject.overlay.setCorners(currentCorners);
    }
  };
  
  preloadImg.onerror = () => {
    console.error(`AI : Failed to load image for overlay ${overlayObject.id}`);
  };
  
  preloadImg.src = newImageUrl;
}

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  if (!map.value) return;


  // AI : Remove all overlays from the map (both distortable and simple image overlays)
  Object.values(overlays.value).forEach((overlayObject) => {
    if (overlayObject.overlay) {
      try {
        map.value!.removeLayer(overlayObject.overlay);
      } catch (error) {
        console.warn(`AI : Error removing overlay ${overlayObject.id}:`, error);
      }
    }
  });

  // AI : Remove all markers from the map
  Object.values(allMarkers.value).forEach((marker) => {
    if (marker) {
      try {
        map.value!.removeLayer(marker);
      } catch (error) {
        console.warn('AI : Error removing marker:', error);
      }
    }
  });
  // AI : Clear the collections completely
  overlays.value = {};
  allMarkers.value = {};
  idSelectedOverlay.value = null;

}

/**
 * AI : Apply selection outline to overlay when selected
 */
function applySelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.projectId) return;

  // AI : Apply 30px outline to all overlays of the same project
  const projectId = overlayObject.projectId;
  const project = projects.value[projectId];
  const color = project?.color ?? '#007bff';

  Object.values(overlays.value).forEach(obj => {
    if (obj.projectId === projectId && obj.overlay) {
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
  // AI : Remove outline from all overlays of the same project
  const projectId = overlayObject.projectId;

  Object.values(overlays.value).forEach(obj => {
    if (obj.projectId === projectId && obj.overlay) {
      const element = obj.overlay.getElement();
      if (element) {
        // AI : Restore original project styling
        const project = projects.value[projectId];
        if (project) {
          element.style.outline = `4px solid ${project.color}`;
        } else {
          element.style.outline = '';
        }
      }
    }
  });
}

/**
 * AI : Highlight all overlays from the same project on hover in view mode
 */
function highlightProjectOverlaysOnHover(projectId: string): void {
  if (!projectId || isEditMode.value) return;

  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Apply simple outline highlighting with project color
        const project = projects.value[projectId];
        const color = project?.color ?? '#007bff';
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

  // AI : Don't remove highlight if any overlay from this project is currently selected
  const selectedOverlay = idSelectedOverlay.value ? overlays.value[idSelectedOverlay.value] : null;
  if (selectedOverlay && selectedOverlay.projectId === projectId) {
    return; // AI : Keep 30px outline because project is selected
  }

  Object.values(overlays.value).forEach(overlayObject => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Remove hover highlighting but keep original project styling
        const project = projects.value[projectId];
        if (project) {
          // AI : Restore original project styling
          element.style.outline = `4px solid ${project.color}`;
        } else {
          // AI : Remove all styling if project not found
          element.style.outline = '';
        }
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

  // AI : Add mouseenter event for highlighting
  element.addEventListener('mouseenter', () => {
    if (!isEditMode.value && overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  // AI : Add mouseleave event for removing highlight
  element.addEventListener('mouseleave', () => {
    if (!isEditMode.value && overlayObject.projectId) {
      removeProjectHighlightOnHover(overlayObject.projectId);
    }
  });
}

/**
 * AI : Render backend CDN overlays on the map for view mode
 * Only renders overlays that haven't been rendered yet to avoid duplicates
 */
export async function renderViewModeOverlays(cdnOverlays: CDNOverlayData[]): Promise<void> {
  if (!map.value) {
    return;
  }
  // AI : Get current overlay IDs that are already rendered (local overlays take precedence)
  const currentOverlayIds = new Set(Object.keys(overlays.value));

  // AI : Only render remote overlays that don't have local versions already loaded
  const overlaysToRender = cdnOverlays.filter(cdnOverlay => {
    const hasLocalVersion = currentOverlayIds.has(cdnOverlay.id);
    if (hasLocalVersion) {
      console.debug(`AI : Overlay ${cdnOverlay.id} already loaded locally, skipping`);
    }
    return !hasLocalVersion;
  });


  // AI : Render each new CDN overlay as a read-only marker in view mode or editable overlay in edit mode
  for (const cdnOverlay of overlaysToRender) {
    await renderSingleViewModeOverlay(cdnOverlay);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 * Simplified version that uses existing helper functions
 */
async function renderSingleViewModeOverlay(cdnOverlay: CDNOverlayData): Promise<void> {
  if (!map.value || overlays.value[cdnOverlay.id]) {
    return;
  }

  try {
    // AI : Convert CDN data to StoredOverlayData format
    const storedOverlayData: StoredOverlayData = {
      id: cdnOverlay.id,
      imageUrl: `http://localhost:3000/uploads/${cdnOverlay.filename}`,
      corners: cdnOverlay.corners.map(corner => L.latLng(corner.lat, corner.lng)),
      history: [],
      redoStack: [],
      projectId: cdnOverlay.projectId ?? '',
      caption: cdnOverlay.caption,
      savedRemotely: true
    };

    // AI : Create marker at centroid position
    const markerTitle = isEditMode.value
      ? `${cdnOverlay.caption ?? 'Overlay'} (Remote - Editable)`
      : `${cdnOverlay.caption ?? 'Overlay'} (View Mode - Read Only)`;

    const marker = L.marker([cdnOverlay.centroid.lat, cdnOverlay.centroid.lng], {
      title: markerTitle,
      opacity: 0.7,
      icon: createColorIcon('green') // AI : Remote overlays are green by default
    }).addTo(map.value);

    allMarkers.value[cdnOverlay.id] = marker;

    // AI : Use existing loadOverlay function to handle the rest
    await loadOverlay(storedOverlayData);
    
    // AI : Get the loaded overlay object and inject CDN project data
    const overlayObject = overlays.value[cdnOverlay.id];
    if (overlayObject) {
      // AI : Inject project data from CDN for InfoPopup display
      if (cdnOverlay.project) {
        overlayObject.project = cdnOverlay.project;
      }

      // AI : Setup project hover events for view mode
      if (overlayObject.overlay) {
        setupProjectHoverEvents(overlayObject.overlay, overlayObject);
      }
    }
  } catch (error) {
    console.error(`AI : Error rendering view mode overlay ${cdnOverlay.id}:`, error);
  }
}

/**
 * AI : Remove a specific overlay from the map and collections
 */
export function removeOverlay(overlayId: string): void {
  if (!map.value) return;

  const overlayObject = overlays.value[overlayId];
  if (!overlayObject) return;

  // AI : Remove overlay from map
  if (overlayObject.overlay) {
    map.value.removeLayer(overlayObject.overlay);
  }

  // AI : Remove marker from map
  if (overlayObject.marker) {
    map.value.removeLayer(overlayObject.marker);
  }

  // AI : Remove from collections
  delete overlays.value[overlayId];
  delete allMarkers.value[overlayId];

  // AI : Clear selection if this overlay was selected
  if (idSelectedOverlay.value === overlayId) {
    idSelectedOverlay.value = null;
  }
}

/**
 * AI : Update marker tooltip based on overlay storage status
 * Only shows tooltips in edit mode, removes them in view mode
 * Also updates marker color based on storage status in edit mode
 */
export function updateMarkerTooltip(overlayObject: OverlayObject): void {
  if (!overlayObject.marker) return;

  // AI : Remove existing tooltip first
  overlayObject.marker.unbindTooltip();

  // AI : Update marker color based on storage status in edit mode
  const markerColor = getMarkerColorForStorageStatus(overlayObject);
  const colorIcon = createColorIcon(markerColor);
  overlayObject.marker.setIcon(colorIcon);

  // AI : Only show tooltips in edit mode
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

  try {
    const savedOverlays = await getAllOverlays();
    const isStoredLocally = savedOverlays.some(overlay => overlay.id === overlayObject.id);

    // AI : For remote overlays, only mark as stored if they actually exist in IndexedDB
    // This prevents remote overlays from showing as "stored locally" unless they've been edited
    overlayObject.alreadyStored = isStoredLocally;
    updateMarkerTooltip(overlayObject);
  } catch (error) {
    console.error('AI : Error checking overlay storage status:', error);
  }
}

/**
 * AI : Determine marker color based on overlay storage status in edit mode
 * Green: Remote only (not stored locally)
 * Orange: Remote and local copy (stored both remotely and locally) 
 * Red: Local only (no remote copy)
 */
function getMarkerColorForStorageStatus(overlayObject: OverlayObject): 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black' {
  // AI : Only apply color coding in edit mode
  if (!isEditMode.value) {
    return 'blue'; // AI : Default blue color for view mode
  }

  const { savedRemotely, alreadyStored } = overlayObject;

  if (savedRemotely && !alreadyStored) {
    return 'green'; // AI : Remote overlay, not stored locally
  } else if (savedRemotely && alreadyStored) {
    return 'orange'; // AI : Remote overlay with local copy
  } else if (!savedRemotely && alreadyStored) {
    return 'red'; // AI : Local only overlay
  }

  // AI : Fallback to blue for any edge cases
  return 'blue';
}
