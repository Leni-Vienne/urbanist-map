import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { ref, shallowRef } from 'vue';
import { map, calculateScreenCoverage, onMapInitialized } from './useMap';
import { getAllOverlays, saveOverlay } from './useDatabase';
import type { OverlayObject, StoredOverlayData } from '../types';
import { editTools, viewTools, infoTool } from './useTools';
import { getImageUrlForCoverage } from './useImageResizer';
import { debounce } from '../utils';
import { applyProjectStyling, projects } from './useProjects';

export const overlays = shallowRef<Record<string, OverlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(true);

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

// Create debounced version of updateImageResolutionsForCoverage function
const debouncedUpdateImageResolutions = debounce(updateImageResolutionsForCoverage, 250);

/**
 * Initialize overlays from database and set up event handlers
 */
export async function initializeOverlays(): Promise<void> {
  const savedOverlays = await getAllOverlays();

  if (!map.value) return;

  const mapBounds = map.value.getBounds();

  // Create all markers first
  createMarkersForOverlays(savedOverlays);

  // Then load only overlays that are within the current view
  loadOverlaysInMapBounds(savedOverlays, mapBounds);

  // Set up event listeners
  setupMapEventListeners();

  // Use the event-based approach for updating resolutions
  onMapInitialized(() => {
    // Update all overlays with appropriate resolutions once map is fully initialized
    updateImageResolutionsForCoverage();
  });
}

/**
 * Set up event listeners for map interactions
 */
function setupMapEventListeners(): void {
  if (!map.value) return;

  // Add event listeners for map interactions
  map.value.on('moveend', loadOverlaysInView);
  map.value.on('zoomend', debouncedUpdateImageResolutions);

  // Handle window resize
  window.removeEventListener('resize', updateImageResolutionsForCoverage);
  window.addEventListener('resize', debouncedUpdateImageResolutions);
}

/**
 * Create markers for all overlays
 */
function createMarkersForOverlays(savedOverlays: StoredOverlayData[]): void {
  if (!map.value) return;

  savedOverlays.forEach(savedOverlay => {
    const overlayBounds = getOverlayBounds(savedOverlay);
    if (!overlayBounds || allMarkers.value[savedOverlay.id]) return;

    // Create marker title from project name and phase if available
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

/**
 * Load overlays that are within the current map bounds
 */
function loadOverlaysInMapBounds(savedOverlays: StoredOverlayData[], mapBounds: L.LatLngBounds): void {
  savedOverlays.forEach(async (savedOverlay) => {
    // Check if overlay is within current map bounds
    if (isOverlayWithinBounds(savedOverlay, mapBounds)) {
      await loadOverlay(savedOverlay);
    }
  });
}

/**
 * Load a single overlay and add it to the map
 */
async function loadOverlay(savedOverlay: StoredOverlayData): Promise<void> {
  const overlayObject = createOverlayObject(savedOverlay);

  // Create bounds object to calculate coverage
  const overlayBounds = getOverlayBounds(savedOverlay);
  if (!overlayBounds) return;

  const coveragePercent = calculateScreenCoverage(overlayBounds);

  // Use the appropriate resolution based on screen coverage
  const imageUrl = savedOverlay.imageResolutions
    ? getImageUrlForCoverage(savedOverlay.imageResolutions, coveragePercent)
    : savedOverlay.imageUrl;

  const newOverlay = await createOverlay(imageUrl, overlayObject);
  if (!newOverlay) return;

  overlayObject.overlay = newOverlay;
  overlayObject.marker = allMarkers.value[savedOverlay.id];
  overlays.value[savedOverlay.id] = overlayObject;
}

/**
 * Helper function to create a bounds object from overlay corners
 */
function getOverlayBounds(overlay: StoredOverlayData): L.LatLngBounds | null {
  // If no corners data or not enough corners, return null
  if (!overlay.corners || overlay.corners.length < 2) {
    return null;
  }

  // Create a bounds object from the overlay corners
  return L.latLngBounds(
    overlay.corners.map(corner => L.latLng(corner.lat, corner.lng))
  );
}

/**
 * Helper function to check if an overlay is within the current map bounds
 */
function isOverlayWithinBounds(overlay: StoredOverlayData, bounds: L.LatLngBounds): boolean {
  if (!overlay.corners || overlay.corners.length === 0) return true;

  const overlayBounds = getOverlayBounds(overlay);
  if (!overlayBounds) return true;

  // Check if the overlay bounds intersect with the map bounds
  return bounds.intersects(overlayBounds);
}

/**
 * Function to load overlays that come into view when panning/zooming
 */
async function loadOverlaysInView(): Promise<void> {
  if (!map.value) return;

  const currentBounds = map.value.getBounds();
  const savedOverlays = await getAllOverlays();

  // Find overlays that aren't loaded yet but are now in view
  savedOverlays.forEach(async (savedOverlay) => {
    const isAlreadyLoaded = overlays.value[savedOverlay.id] !== undefined;

    if (!isAlreadyLoaded && isOverlayWithinBounds(savedOverlay, currentBounds)) {
      await loadOverlay(savedOverlay);
    }
  });
}

/**
 * Function to update overlay image resolutions based on screen coverage
 */
function updateImageResolutionsForCoverage(): void {
  if (!map.value) return;
  
  // Get current map bounds to check visibility
  const currentMapBounds = map.value.getBounds();

  Object.entries(overlays.value).forEach(([_id, overlayObject]) => {
    if (!overlayObject.overlay || !overlayObject.imageResolutions) return;

    const bounds = overlayObject.overlay.getBounds();
    
    // Check if bounds are valid before using them
    if (!bounds || !bounds.isValid()) {
      return;
    }
    
    // Skip resolution update for overlays that aren't visible on the map
    if (!currentMapBounds.intersects(bounds)) {
      return;
    }
    
    // Only calculate coverage for visible overlays
    const coveragePercent = calculateScreenCoverage(bounds);

    // Get the optimal resolution for this coverage
    const bestResolutionUrl = getImageUrlForCoverage(overlayObject.imageResolutions, coveragePercent);
    if (!bestResolutionUrl) return;

    // Only update if the best resolution is different from current
    if (bestResolutionUrl !== overlayObject.currentResolution) {
      updateOverlayImage(overlayObject, bestResolutionUrl);
      overlayObject.currentResolution = bestResolutionUrl;
    }
  });
}

/**
 * Create a new overlay object from saved data
 */
export function createOverlayObject(savedOverlay: StoredOverlayData): OverlayObject {
  return {
    ...savedOverlay,
    overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
    currentResolution: savedOverlay.imageUrl,
  };
}

/**
 * Create a Leaflet overlay on the map
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
      ...editTools
    ],
  }).addTo(map.value);

  overlayObject.overlay = newOverlay;

  // Apply project styling if this overlay belongs to a project
  if (overlayObject.projectId) {
    applyProjectStyling(overlayObject, overlayObject.projectId!);
  }

  // Set up event handlers
  setupOverlayEventHandlers(newOverlay, overlayObject);

  const element = newOverlay.getElement();
  if (!element) {
    console.error('Element not found for overlay:', overlayObject.id);
    return null;
  }

  // Set up load event handler
  L.DomEvent.on(element, 'load', () => {
    applyOverlayCorners(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.alreadyLoaded = true;
    overlayObject.alreadyStored = true;
  });

  return newOverlay;
}

/**
 * Set up event handlers for an overlay
 */
function setupOverlayEventHandlers(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  // Update border on selection
  overlay.on('select', () => {
    idSelectedOverlay.value = overlayObject.id;
  });

  overlay.on('deselect', () => {
    idSelectedOverlay.value = null;
  });

  // Disable keyboard handling on the overlay
  if (overlay.editing && overlay.editing._disableKeyboard) {
    overlay.editing._disableKeyboard();
  }

  // Add event listeners for transformations
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
 * Helper function to apply the correct corners to an overlay
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
    // Save initial state to history
    const initialState = overlayObject.overlay.getCorners();
    overlayObject.history = [initialState];
    overlayObject.redoStack = [];
  }
}

/**
 * Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.marker) return;
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

/**
 * Save the current state of an overlay to history
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  // Create a deep copy of the current corners
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = [];

  // Update corners directly for persistence
  overlayObject.corners = overlayObject.overlay.getCorners();

  // Create a serializable object for database storage
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

  // Save to database
  saveOverlay(savedOverlay);
}

/**
 * Toggle edit mode for all overlays
 */
export function toggleEditMode(): void {
  isEditMode.value = !isEditMode.value;

  Object.values(overlays.value).forEach((overlayObject) => {
    if (!overlayObject.overlay) return;

    const editing = overlayObject.overlay.editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }

    // No longer applying any border or shadow for edit mode
    // Project-specific styling will be handled by the project functionality
  });
}

/**
 * Load a specific overlay by ID
 */
export async function loadOverlayById(id: string): Promise<void> {
  if (!map.value) return;

  // Get overlay data from database
  const allOverlays = await getAllOverlays();
  const savedOverlay = allOverlays.find(overlay => overlay.id === id);

  if (!savedOverlay) {
    console.error(`Overlay with ID ${id} not found in database`);
    return;
  }

  await loadOverlay(savedOverlay);
}

/**
 * Update an overlay's image without recreating the overlay
 */
export function updateOverlayImage(overlayObject: OverlayObject, newImageUrl: string): void {
  if (!overlayObject.overlay) return;

  try {
    // Store current corners before changing the image
    const currentCorners = overlayObject.overlay.getCorners();
    
    // Direct approach: Update the src attribute of the image element
    const imgElement = overlayObject.overlay.getElement();
    if (imgElement) {
      // Add event listeners to confirm image loading
      const onLoadListener = () => {
        // Re-apply the corners when the new image is loaded
        if (overlayObject.overlay && currentCorners) {
          overlayObject.overlay.setCorners(currentCorners);
        }
        imgElement.removeEventListener('load', onLoadListener);
      };

      const onErrorListener = (error: any) => {
        console.error(`Error loading new image for overlay ${overlayObject.id}`, error);
        imgElement.removeEventListener('error', onErrorListener);
      };

      imgElement.addEventListener('load', onLoadListener);
      imgElement.addEventListener('error', onErrorListener);

      // Change image source
      imgElement.src = newImageUrl;

      // Update current resolution in the object
      overlayObject.currentResolution = newImageUrl;
      return;
    }

    // Fallback: Try using setUrl method if available
    if (typeof overlayObject.overlay.setUrl === 'function') {
      overlayObject.overlay.setUrl(newImageUrl);
      // Re-apply corners after changing URL
      setTimeout(() => {
        if (overlayObject.overlay && currentCorners) {
          overlayObject.overlay.setCorners(currentCorners);
        }
      }, 50);
      overlayObject.currentResolution = newImageUrl;
    }
  } catch (error) {
    console.error(`Error updating image for overlay ${overlayObject.id}:`, error);
  }
}