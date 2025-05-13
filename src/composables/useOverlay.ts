import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { ref, shallowRef, watch } from 'vue';
import { map, onMapInitialized } from '@composables/useMap';
import { getAllOverlays, saveOverlay } from '@composables/useDatabase';
import type { OverlayObject, StoredOverlayData } from '@types';
import { editTools, viewTools, infoTool } from '@composables/useTools';
import { getImageUrlForCoverage } from '@composables/useImageResizer';
import { applyProjectStyling, projects } from '@composables/useProjects';
import { router } from '../router';

export const overlays = shallowRef<Record<string, OverlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(true);

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

// AI : Watch for changes in the overlays reactive reference to ensure persistent storage
watch(overlays, (newOverlays) => {
  // AI : Save all overlays whenever the overlay collection changes
  Object.values(newOverlays).forEach(overlayObj => {
    if (overlayObj && overlayObj.alreadyLoaded) {
      const savedOverlay: StoredOverlayData = {
        id: overlayObj.id,
        imageUrl: overlayObj.imageUrl,
        imageResolutions: overlayObj.imageResolutions,
        corners: overlayObj.corners,
        history: overlayObj.history,
        redoStack: overlayObj.redoStack,
        projectId: overlayObj.projectId,
        phase: overlayObj.phase,
        sequenceNumber: overlayObj.sequenceNumber
      };

      saveOverlay(savedOverlay);
    }
  });
}, { deep: true });

/**
 * AI : Initialize overlays from database and set up event handlers
 */
export async function initializeOverlays(): Promise<void> {
  const savedOverlays = await getAllOverlays();

  if (!map.value) return;

  const mapBounds = map.value.getBounds();

  createMarkersForOverlays(savedOverlays);
  loadOverlaysInMapBounds(savedOverlays, mapBounds);
  setupMapEventListeners();

  onMapInitialized(() => {
    updateImageResolutionsForCoverage();
  });
}

function setupMapEventListeners(): void {
  if (!map.value) return;

  map.value.on('moveend', loadOverlaysInView);
  map.value.on('zoomend', updateImageResolutionsForCoverage);
  window.addEventListener('resize', updateImageResolutionsForCoverage);
}

function createMarkersForOverlays(savedOverlays: StoredOverlayData[]): void {
  if (!map.value) return;

  savedOverlays.forEach(savedOverlay => {
    const overlayBounds = getOverlayBounds(savedOverlay);
    if (!overlayBounds || allMarkers.value[savedOverlay.id]) return;

    let markerTitle = 'Overlay';
    if (savedOverlay.projectId && projects.value[savedOverlay.projectId]) {
      const project = projects.value[savedOverlay.projectId];
      markerTitle = `${project.name}${savedOverlay.phase ? ` - ${savedOverlay.phase}` : ''}`;
    }

    const center = overlayBounds.getCenter();
    const marker = L.marker(center, {
      title: markerTitle
    }).addTo(map.value!);

    allMarkers.value[savedOverlay.id] = marker;
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

  const imageUrl = savedOverlay.imageResolutions
    ? getImageUrlForCoverage(savedOverlay.imageResolutions, overlayBounds, map.value)
    : savedOverlay.imageUrl;

  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  overlayObject.overlay = newOverlay;
  overlayObject.marker = allMarkers.value[savedOverlay.id];
  overlays.value[savedOverlay.id] = overlayObject;
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
 * AI : Function to update overlay image resolutions based on display size
 */
function updateImageResolutionsForCoverage(): void {
  if (!map.value) return;
  const currentMapBounds = map.value.getBounds();

  Object.entries(overlays.value).forEach(([_id, overlayObject]) => {
    if (!overlayObject.overlay || !overlayObject.imageResolutions) return;

    const bounds = overlayObject.overlay.getBounds();

    if (!bounds || !bounds.isValid()) {
      return;
    }

    if (!currentMapBounds.intersects(bounds)) {
      return;
    }

    const bestResolutionUrl = getImageUrlForCoverage(overlayObject.imageResolutions, bounds, map.value);
    if (!bestResolutionUrl) return;

    if (bestResolutionUrl !== overlayObject.currentResolution) {
      updateOverlayImage(overlayObject, bestResolutionUrl);
      overlayObject.currentResolution = bestResolutionUrl;
    }
  });
}

/**
 * AI : Create a new overlay object from saved data
 */
export function createOverlayObject(savedOverlay: StoredOverlayData): OverlayObject {
  return {
    ...savedOverlay,
    overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
    isFlipped: false, // AI : Initialize as not flipped
    currentResolution: savedOverlay.imageUrl,
  };
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
    editable: isEditMode.value,
    keyboard: false,
    actions: [
      infoTool,
      ...(isEditMode.value ? editTools : viewTools)
    ],
  })

  newOverlay.unbindTooltip()
  newOverlay.addTo(map.value);

  overlayObject.overlay = newOverlay;

  if (overlayObject.projectId) {
    applyProjectStyling(overlayObject, overlayObject.projectId!);
  }

  setupOverlayEventHandlers(newOverlay, overlayObject);

  const element = newOverlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return null;
  }

  if (!isEditMode.value) {
    element.style.cursor = 'not-allowed';

    element.addEventListener('mousedown', blockMovementEvent, true);
    element.addEventListener('touchstart', blockMovementEvent, true);
    element.addEventListener('dragstart', blockMovementEvent, true);

    if (newOverlay.off) {
      newOverlay.off('mousedown');
      newOverlay.off('touchstart');
      newOverlay.off('dragstart');
      newOverlay.off('drag');
      newOverlay.off('dragend');
      // Do NOT remove 'click' as we need it for toolbar
    }
  }

  // using 'element' allows to access the corners of the image on load while newOverlay.on('load') doesn't work
  // credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228
  L.DomEvent.on(element, 'load', () => {
    applyOverlayCorners(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.alreadyLoaded = true;
    overlayObject.alreadyStored = true;

    // AI : Save overlay to database immediately after loading
    const savedOverlay: StoredOverlayData = {
      id: overlayObject.id,
      imageUrl: overlayObject.imageUrl,
      imageResolutions: overlayObject.imageResolutions,
      corners: overlayObject.corners || overlayObject.overlay?.getCorners() || [],
      history: overlayObject.history,
      redoStack: overlayObject.redoStack,
      projectId: overlayObject.projectId,
      phase: overlayObject.phase,
      sequenceNumber: overlayObject.sequenceNumber
    };
    saveOverlay(savedOverlay);

    if (!isEditMode.value && overlayObject.overlay) {
      const corners = overlayObject.overlay.getCorners();
      if (corners && corners.length === 4) {
        setTimeout(() => {
          if (overlayObject.overlay) {
            overlayObject.overlay.setCorners(corners);
          }
        }, 50);
      }
    }
  });

  return newOverlay;
}

function setupOverlayEventHandlers(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {

  overlay.on('select', () => {
    console.log('AI: Overlay selected:', overlayObject.id);
    overlay.unbindTooltip();
    // AI : Simply update the selected overlay ID
    idSelectedOverlay.value = overlayObject.id;

    // AI : Update URL only, without moving the camera
    updateUrlWithOverlayId(overlayObject.id);
  });

  overlay.on('deselect', () => {
    idSelectedOverlay.value = null;

    // AI : Clear overlay parameter from URL when deselected
    clearOverlayFromUrl();
  });

  overlay.on('edit', () => {
    saveToHistory(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.corners = overlay.getCorners();
  });

  overlay.on('dragend', () => {
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

    // AI : Set the flag to indicate URL change is from a direct overlay click
    if (window.isUrlChangeFromClick !== undefined) {
      window.isUrlChangeFromClick.value = true;
    }
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
  }
  // Priority 3: Create new history for new overlay
  else {
    const initialState = overlayObject.overlay.getCorners();
    overlayObject.history = [initialState];
    overlayObject.redoStack = [];
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
    imageResolutions: overlayObject.imageResolutions,
    corners: overlayObject.corners,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    projectId: overlayObject.projectId,
    phase: overlayObject.phase,
    sequenceNumber: overlayObject.sequenceNumber
  };

  saveOverlay(savedOverlay);
}

/**
 * AI : Toggle edit mode for all overlays
 */
export function toggleEditMode(): void {
  isEditMode.value = !isEditMode.value;

  Object.values(overlays.value).forEach((overlayObject) => {
    if (!overlayObject.overlay) return;

    const editing = overlayObject.overlay.editing;
    const element = overlayObject.overlay.getElement();

    if (isEditMode.value) {
      // adding and removing tools is finicky (tools are often removed from the arrays) but this way works
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));

      if (element) {
        element.style.pointerEvents = 'auto';
        element.style.cursor = '';

        element.removeEventListener('mousedown', blockMovementEvent, true);
        element.removeEventListener('touchstart', blockMovementEvent, true);
        element.removeEventListener('dragstart', blockMovementEvent, true);
      }
    } else {
      // adding and removing tools is finicky (tools are often removed from the arrays) but this way works
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));

      if (element) {
        element.style.cursor = 'not-allowed';

        // We'll keep pointer-events enabled so clicks work, but block specific events
        // that would cause movement
        element.addEventListener('mousedown', blockMovementEvent, true);
        element.addEventListener('touchstart', blockMovementEvent, true);
        element.addEventListener('dragstart', blockMovementEvent, true);
      }

      if (overlayObject.overlay.off) {
        overlayObject.overlay.off('mousedown');
        overlayObject.overlay.off('touchstart');
        overlayObject.overlay.off('dragstart');
        overlayObject.overlay.off('drag');
        overlayObject.overlay.off('dragend');
        // Do NOT remove 'click' as we need it for toolbar
      }

      const corners = overlayObject.overlay.getCorners();

      if (corners && corners.length === 4 && overlayObject.overlay) {
        overlayObject.overlay.setCorners(corners);
      }
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
 * AI : Load a specific overlay by ID from the database
 */
export async function loadOverlayById(id: string): Promise<void> {
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
 * Uses preloading to avoid flickering and positioning issues during resolution transitions
 */
export function updateOverlayImage(overlayObject: OverlayObject, newImageUrl: string): void {
  if (!overlayObject.overlay) return;

  try {
    const currentCorners = overlayObject.overlay.getCorners();
    const imgElement = overlayObject.overlay.getElement();
    
    // If the image element is available in the DOM
    if (imgElement) {
      // Preload the new image first to avoid flickering
      const preloadImg = new Image();
        preloadImg.onload = () => {
        // Only update the src when the image is fully loaded
        imgElement.src = newImageUrl;
        overlayObject.currentResolution = newImageUrl;
        
        // Ensure corners are preserved after image is updated
        if (overlayObject.overlay && currentCorners) {
          // Apply corners in the next animation frame to ensure image is rendered
          requestAnimationFrame(() => {
            if (overlayObject.overlay) {
              overlayObject.overlay.setCorners(currentCorners);
            }
          });
        }
      };
      
      preloadImg.onerror = (error: any) => {
        console.error(`Error preloading new image for overlay ${overlayObject.id}`, error);
      };
      
      // Start preloading
      preloadImg.src = newImageUrl;
      return;
    }    // Fallback: Try using setUrl method if available
    if (overlayObject.overlay && typeof overlayObject.overlay.setUrl === 'function') {
      // Create a preload image even for the setUrl method
      const preloadImg = new Image();
        preloadImg.onload = () => {
        if (overlayObject.overlay) {
          overlayObject.overlay.setUrl(newImageUrl);
          overlayObject.currentResolution = newImageUrl;
          
          // Ensure corners are preserved after image update
          requestAnimationFrame(() => {
            if (overlayObject.overlay && currentCorners) {
              overlayObject.overlay.setCorners(currentCorners);
            }
          });
        }
      };
      
      preloadImg.onerror = (error: any) => {
        console.error(`Error preloading new image for overlay ${overlayObject.id}`, error);
      };
      
      // Start preloading
      preloadImg.src = newImageUrl;
    }
  } catch (error) {
    console.error(`Error updating image for overlay ${overlayObject.id}:`, error);
  }
}