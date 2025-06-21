import L from "leaflet";
import 'leaflet-toolbar'
import 'leaflet-distortableimage'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { ref, shallowRef } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { getAllOverlays, saveOverlay } from '@composables/core/useDatabase';
import type { OverlayObject, StoredOverlayData, CDNOverlayData } from '@types';
import { editTools, viewTools, infoTool } from '@composables/core/useTools';
import { getImageUrlForCoverage } from '@composables/core/useImageResizer';
import { applyProjectStyling, projects } from '@composables/project/useProjects';
import { router } from '../../router';
import { trpc } from '@client';

export const overlays = shallowRef<Record<string, OverlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(true);

// Tracking of all markers, even for images not currently loaded
export const allMarkers = shallowRef<Record<string, L.Marker>>({});

// AI : Save an individual overlay to the database
// This is called explicitly when an overlay changes, rather than watching the entire collection
export function saveOverlayToDatabase(overlayObj: OverlayObject): void {
  if (!overlayObj || !overlayObj.alreadyLoaded || !overlayObj.alreadyStored) return;
  
  const savedOverlay: StoredOverlayData = {
    id: overlayObj.id,
    imageUrl: overlayObj.imageUrl,
    imageResolutions: overlayObj.imageResolutions,
    corners: overlayObj.corners,
    history: overlayObj.history,
    redoStack: overlayObj.redoStack,
    projectId: overlayObj.projectId,
    caption: overlayObj.caption,
    savedRemotely: overlayObj.savedRemotely || false
  };

  saveOverlay(savedOverlay);
}

/**
 * AI : Initialize overlays from database and set up event handlers
 * In edit mode: loads from both local IndexedDB and backend, in view mode: handled by useViewModeOverlays
 */
export async function initializeOverlays(): Promise<void> {
  if (!map.value) return;

  // AI : In view mode, skip local database entirely
  if (!isEditMode.value) {
    setupMapEventListeners();
    return;
  }
  // AI : In edit mode, load from both local database and backend
  const savedOverlays = await getAllOverlays();
  const mapBounds = map.value.getBounds();

  createMarkersForOverlays(savedOverlays);
  loadOverlaysInMapBounds(savedOverlays, mapBounds);
  
  // AI : Also fetch and load backend overlays for edit mode
  await loadBackendOverlaysForEditMode(mapBounds);
  
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
      markerTitle = `${project.name}${savedOverlay.caption ? ` - ${savedOverlay.caption}` : ''}`;
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
  // AI : Get project data from local projects collection if available
  const projectData = savedOverlay.projectId && projects.value[savedOverlay.projectId] 
    ? {
        id: projects.value[savedOverlay.projectId].id,
        title: projects.value[savedOverlay.projectId].name,
        description: projects.value[savedOverlay.projectId].description || null,
        metadata: { color: projects.value[savedOverlay.projectId].color },
        createdAt: new Date(projects.value[savedOverlay.projectId].createdAt),
        updatedAt: new Date(projects.value[savedOverlay.projectId].updatedAt)
      }
    : null;

  return {
    ...savedOverlay,
    overlay: null,
    marker: null,
    alreadyLoaded: false,
    alreadyStored: true,
    whitePixelsHidden: false,
    isFlipped: false, // AI : Initialize as not flipped
    currentResolution: savedOverlay.imageUrl,
    savedRemotely: savedOverlay.savedRemotely || false, // AI : Default to false if not set
    project: projectData // AI : Include project data for InfoPopup display, will be updated from backend if needed
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
    editable: true,
    keyboard: false,
    actions: [
      infoTool,
      ...(isEditMode.value ? editTools : viewTools)
    ],
  })

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
    configureOverlayEditingState(newOverlay, element, false);
  }
  // using 'element' allows to access the corners of the image on load while newOverlay.on('load') doesn't work
  // credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228
  L.DomEvent.on(element, 'load', () => {
    applyOverlayCorners(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.alreadyLoaded = true;
    overlayObject.alreadyStored = true;    // AI : Save initial corner positions to history for undo/redo functionality
    if (overlayObject.overlay && overlayObject.history.length === 0) {
      const initialCorners = overlayObject.overlay.getCorners();
      if (initialCorners && initialCorners.length > 0) {
        overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))];
        overlayObject.redoStack = [];
      }
    }// AI : Save overlay to database immediately after loading
    const savedOverlay: StoredOverlayData = {
      id: overlayObject.id,      imageUrl: overlayObject.imageUrl,
      imageResolutions: overlayObject.imageResolutions,
      corners: overlayObject.corners || overlayObject.overlay?.getCorners() || [],
      history: overlayObject.history,
      redoStack: overlayObject.redoStack,
      projectId: overlayObject.projectId,
      caption: overlayObject.caption,
      savedRemotely: overlayObject.savedRemotely || false // AI : Include server existence tracking
    };
    if(isEditMode.value) {
      saveOverlay(savedOverlay);
    }
  });

  return newOverlay;
}

function setupOverlayEventHandlers(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {

  overlay.on('select', () => {
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
    // AI : Handle transition from backend to local copy when edited
    handleOverlayMovement(overlayObject);
    updateMarkerPosition(overlayObject);
    overlayObject.corners = overlay.getCorners();
  });

  overlay.on('dragend', () => {
    // AI : Handle transition from backend to local copy when moved
    handleOverlayMovement(overlayObject);
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
    imageResolutions: overlayObject.imageResolutions,    corners: overlayObject.corners,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
    projectId: overlayObject.projectId,
    caption: overlayObject.caption,
    savedRemotely: overlayObject.savedRemotely || false // AI : Include server existence tracking
  };

  saveOverlay(savedOverlay);
}

/**
 * AI : Toggle edit mode for all overlays with proper cleanup
 */
export async function toggleEditMode(): Promise<void> {
  isEditMode.value = !isEditMode.value;

  // AI : Clear all current overlays when switching modes
  clearAllOverlays();
  
  if (isEditMode.value) {
    // AI : Switching to edit mode - ensure projects are loaded before initializing overlays
    // AI : Import initializeProjects dynamically to avoid circular dependency
    const { initializeProjects } = await import('@composables/project/useProjects');
    
    // AI : Ensure projects are loaded before initializing overlays
    await initializeProjects();
    
    await initializeOverlays();
  } else {
    // AI : Switching to view mode - overlays will be handled by useViewModeOverlays
  }
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
 * AI : Configure overlay editing state based on edit mode
 * @param overlay - The overlay to configure
 * @param element - The HTML element of the overlay
 * @param enableEditing - Whether to enable (true) or disable (false) editing
 */
function configureOverlayEditingState(overlay: L.DistortableImageOverlay, element: HTMLElement, enableEditing: boolean): void {
  if (enableEditing) {
    // Enable editing
    element.style.pointerEvents = 'auto';
    element.style.cursor = '';

    element.removeEventListener('mousedown', blockMovementEvent, true);
    element.removeEventListener('touchstart', blockMovementEvent, true);
    element.removeEventListener('dragstart', blockMovementEvent, true);
  } else {
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

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  if (!map.value) return;

  console.log(`AI : Clearing all overlays from map - currently have ${Object.keys(overlays.value).length} overlays and ${Object.keys(allMarkers.value).length} markers`);

  // AI : Remove all overlays from the map (both distortable and simple image overlays)
  Object.values(overlays.value).forEach((overlayObject) => {
    if (overlayObject.overlay) {
      try {
        map.value!.removeLayer(overlayObject.overlay);
        console.log(`AI : Removed overlay ${overlayObject.id} from map`);
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

  console.log('AI : All overlays and markers cleared from collections');
}

/**
 * AI : Render backend CDN overlays on the map for view mode
 * Only renders overlays that haven't been rendered yet to avoid duplicates
 */
export async function renderViewModeOverlays(cdnOverlays: CDNOverlayData[]): Promise<void> {
  if (!map.value || isEditMode.value) {
    console.log('AI : Cannot render view mode overlays - map not ready or not in view mode');
    return;
  }

  // AI : Get current overlay IDs that are already rendered
  const currentOverlayIds = new Set(Object.keys(overlays.value));

  // AI : Only render overlays that haven't been rendered yet
  const overlaysToRender = cdnOverlays.filter(cdnOverlay => !currentOverlayIds.has(cdnOverlay.id));

  // AI : Render each new CDN overlay as a read-only marker
  for (const cdnOverlay of overlaysToRender) {
    console.log(`AI : Rendering CDN overlay ${cdnOverlay.id} in view mode`);
    await renderSingleViewModeOverlay(cdnOverlay);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 * Uses the existing createOverlay function to eliminate code duplication
 */
async function renderSingleViewModeOverlay(cdnOverlay: CDNOverlayData): Promise<void> {
  if (!map.value) {
    console.warn('AI : Map not available for rendering view mode overlay');
    return;
  }

  // AI : Check if overlay is already rendered to avoid duplicates
  if (overlays.value[cdnOverlay.id]) {
    return;
  }

  try {    // AI : Construct image URL from backend server
    const imageUrl = `http://localhost:3000/uploads/${cdnOverlay.filename}`;

    // AI : Use the actual corners from the backend instead of calculating from centroid
    const corners = cdnOverlay.corners.map(corner => L.latLng(corner.lat, corner.lng));    // AI : Create overlay object for view mode using same structure as edit mode
    const overlayObject: OverlayObject = {      id: cdnOverlay.id,
      imageUrl: imageUrl,
      imageResolutions: undefined,
      corners: corners,
      history: [],
      redoStack: [],
      projectId: cdnOverlay.projectId || '', // AI : Use project ID from backend data
      caption: cdnOverlay.caption || undefined,
      overlay: null,
      marker: null,
      alreadyLoaded: false,
      alreadyStored: false,
      whitePixelsHidden: false,
      isFlipped: false,
      currentResolution: imageUrl,
      savedRemotely: true, // AI : CDN overlays exist on server by definition
      // AI : Include project data from backend for InfoPopup display
      project: cdnOverlay.project || null
    };

    // AI : Use existing createOverlay function instead of duplicating overlay creation logic
    const newOverlay = await createOverlay(imageUrl, overlayObject);

    if (!newOverlay) {
      console.error('AI : Failed to create overlay for view mode');
      return;
    }    // AI : Apply project styling if overlay has project data from backend
    if (cdnOverlay.project && cdnOverlay.project.id) {
      // AI : Create a temporary project object from backend data for styling
      const tempProject = {
        id: cdnOverlay.project.id,
        name: cdnOverlay.project.title,
        description: cdnOverlay.project.description || '',
        color: (cdnOverlay.project.metadata as any)?.color || '#007bff', // AI : Extract color from metadata
        overlayIds: [],
        location: '',
        startDate: null,
        endDate: null,
        sourceUrl: '',
        createdAt: cdnOverlay.project.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: cdnOverlay.project.updatedAt?.toISOString() || new Date().toISOString()
      };

      // AI : Temporarily store project for styling (don't persist)
      const originalProjects = { ...projects.value };
      projects.value[tempProject.id] = tempProject;
      
      // AI : Apply project styling
      applyProjectStyling(overlayObject, tempProject.id);
      
      // AI : Restore original projects (we don't want to persist backend project data)
      projects.value = originalProjects;
    }// AI : Create marker for easier identification using centroid
    const centerLat = cdnOverlay.centroid.lat;
    const centerLng = cdnOverlay.centroid.lng;
    const marker = L.marker([centerLat, centerLng], {
      title: `${cdnOverlay.caption || 'Overlay'} (View Mode - Read Only)`,
      opacity: 0.7
    }).addTo(map.value);

    overlayObject.marker = marker;

    // AI : Store both overlay and marker for cleanup
    overlays.value[cdnOverlay.id] = overlayObject;
    allMarkers.value[cdnOverlay.id] = marker;
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
 * AI : Load backend overlays for edit mode - creates read-only overlays that become editable when moved
 * @param mapBounds - Current map bounds to fetch overlays for
 */
async function loadBackendOverlaysForEditMode(mapBounds: L.LatLngBounds): Promise<void> {
  if (!map.value || !isEditMode.value) return;

  try {
    console.log('AI : Fetching backend overlays for edit mode');
    
    // AI : Fetch overlays from backend using the same bounds format as view mode
    const result = await trpc.overlay.getIntersectingOverlays.query({
      north: mapBounds.getNorth(),
      south: mapBounds.getSouth(),
      east: mapBounds.getEast(),
      west: mapBounds.getWest()
    });

    console.log(`AI : Found ${result.overlays.length} backend overlays for edit mode`);    // AI : For each backend overlay, create an editable overlay if not already loaded locally
    for (const cdnOverlay of result.overlays) {      // AI : If we already have this overlay locally, update it with backend project data
      if (overlays.value[cdnOverlay.id]) {
        console.log(`AI : Overlay ${cdnOverlay.id} already exists locally, updating with backend project data`);
        
        const localOverlay = overlays.value[cdnOverlay.id];
        
        // AI : Update local overlay with backend project information if available
        if (cdnOverlay.project && !localOverlay.project) {
          console.log(`AI : Adding backend project data to local overlay ${cdnOverlay.id}`);
          localOverlay.project = cdnOverlay.project;
          
          // AI : Apply project styling now that we have project data
          if (cdnOverlay.projectId) {
            applyProjectStyling(localOverlay, cdnOverlay.projectId);
          }
        }
        
        // AI : Check if local overlay has backend flag set correctly
        if (!localOverlay.savedRemotely && localOverlay.alreadyStored) {
          // AI : This is a local copy, but we also have it on backend - no action needed
          console.log(`AI : Overlay ${cdnOverlay.id} is a local copy with backend version available`);
        } else if (!localOverlay.savedRemotely && !localOverlay.alreadyStored) {
          // AI : This shouldn't happen - local overlay without proper flags
          console.warn(`AI : Overlay ${cdnOverlay.id} has inconsistent state, fixing...`);
          localOverlay.savedRemotely = true;
          localOverlay.alreadyStored = false;
        }
        continue;
      }

      await renderBackendOverlayForEditMode(cdnOverlay);
    }
  } catch (error) {
    console.error('AI : Error loading backend overlays for edit mode:', error);
  }
}

/**
 * AI : Render a single backend overlay as editable in edit mode
 * These overlays can be moved/edited and will automatically be saved to local IndexedDB
 */
async function renderBackendOverlayForEditMode(cdnOverlay: CDNOverlayData): Promise<void> {
  if (!map.value) return;

  try {
    // AI : Construct image URL from backend server
    const imageUrl = `http://localhost:3000/uploads/${cdnOverlay.filename}`;

    // AI : Use the actual corners from the backend
    const corners = cdnOverlay.corners.map(corner => L.latLng(corner.lat, corner.lng));    // AI : Create overlay object that tracks it's from backend
    const overlayObject: OverlayObject = {      id: cdnOverlay.id,
      imageUrl: imageUrl,
      imageResolutions: undefined,
      corners: corners,
      history: [],
      redoStack: [],
      projectId: cdnOverlay.projectId || '', // AI : Use project ID from backend or fallback to empty string
      caption: cdnOverlay.caption || undefined,
      overlay: null,
      marker: null,
      alreadyLoaded: false,
      alreadyStored: false,
      whitePixelsHidden: false,
      isFlipped: false,
      currentResolution: imageUrl,
      savedRemotely: true, // AI : Backend overlays exist on server by definition
      // AI : Include project data from backend for InfoPopup display
      project: cdnOverlay.project || null
    };    // AI : Create the overlay using existing function
    const newOverlay = await createOverlay(imageUrl, overlayObject);

    if (!newOverlay) {
      console.error('AI : Failed to create backend overlay for edit mode');
      return;
    }

    // AI : Backend overlays already have corners from the server, so set them up properly
    // AI : The initial history will be created in the image load event handler// AI : Apply visual styling to distinguish backend overlays only if no project styling
    const element = newOverlay.getElement();
    if (element && !overlayObject.projectId) {
      // AI : Only apply blue border if overlay has no project (project styling takes precedence)
      element.style.border = '2px solid #007bff'; // Blue border for backend overlays without projects
      element.style.opacity = '0.85'; // Slightly transparent to show it's from backend
    } else if (element && overlayObject.projectId) {
      // AI : For backend overlays with projects, apply project styling with backend data
      element.style.opacity = '0.9'; // Slightly transparent to show it's from backend
      
      // AI : Apply project styling using backend project data if available
      if (cdnOverlay.project && cdnOverlay.project.id) {
        // AI : Create a temporary project object from backend data for styling
        const tempProject = {
          id: cdnOverlay.project.id,
          name: cdnOverlay.project.title,
          description: cdnOverlay.project.description || '',
          color: (cdnOverlay.project.metadata as any)?.color || '#007bff', // AI : Extract color from metadata
          overlayIds: [],
          location: '',
          startDate: null,
          endDate: null,
          sourceUrl: '',
          createdAt: cdnOverlay.project.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt: cdnOverlay.project.updatedAt?.toISOString() || new Date().toISOString()
        };

        // AI : Temporarily store project for styling (don't persist)
        const originalProjects = { ...projects.value };
        projects.value[tempProject.id] = tempProject;
        
        // AI : Apply project styling
        applyProjectStyling(overlayObject, tempProject.id);
        
        // AI : Restore original projects (we don't want to persist backend project data)
        projects.value = originalProjects;
      } else {
        // AI : Fallback to existing project styling if available locally
        applyProjectStyling(overlayObject, overlayObject.projectId);
      }
    }

    // AI : Create marker for easier identification using centroid
    const centerLat = cdnOverlay.centroid.lat;
    const centerLng = cdnOverlay.centroid.lng;
    const marker = L.marker([centerLat, centerLng], {
      title: `${cdnOverlay.caption || 'Backend Overlay'} (From Server)`,
      opacity: 0.8
    }).addTo(map.value);

    overlayObject.marker = marker;

    // AI : Store both overlay and marker
    overlays.value[cdnOverlay.id] = overlayObject;
    allMarkers.value[cdnOverlay.id] = marker;

    console.log(`AI : Backend overlay ${cdnOverlay.id} loaded for edit mode with visual distinction`);
  } catch (error) {
    console.error(`AI : Error rendering backend overlay ${cdnOverlay.id} for edit mode:`, error);
  }
}

/**
 * AI : Handle overlay movement by converting backend overlays to local copies when moved
 * @param overlayObject - The overlay object that was moved
 */
function handleOverlayMovement(overlayObject: OverlayObject): void {
  // AI : If this is a backend overlay (savedRemotely is true and no local storage yet)
  if (overlayObject.savedRemotely && !overlayObject.alreadyStored) {
    console.log(`AI : Converting backend overlay ${overlayObject.id} to local copy due to movement`);
    
    // AI : Mark as no longer existing only on backend (now has local changes)
    overlayObject.savedRemotely = false;
    overlayObject.alreadyStored = true;
    
    // AI : Update marker title to indicate it's now a local copy
    if (overlayObject.marker) {
      const newTitle = `${overlayObject.caption || 'Overlay'} (Local Copy - Modified)`;
      overlayObject.marker.setTooltipContent(newTitle);
      overlayObject.marker.bindTooltip(newTitle, { permanent: false });
    }
    
    // AI : Force a visual refresh to ensure the overlay appears correctly as a local copy
    if (overlayObject.overlay && map.value) {
      // AI : Get current position and state
      const currentCorners = overlayObject.overlay.getCorners();
      const element = overlayObject.overlay.getElement();
      
      if (element && currentCorners) {
        // AI : Update the overlay's corners to trigger a refresh
        overlayObject.corners = currentCorners;
        
        // AI : Update the overlay's visual properties to reflect local copy status
        element.style.border = '2px solid #28a745'; // Green border for local copy
        element.style.opacity = '1.0'; // Full opacity for local copy
        
        // AI : Apply a brief visual indicator that the conversion happened
        element.style.boxShadow = '0 0 10px rgba(40, 167, 69, 0.5)';
        setTimeout(() => {
          if (element) {
            element.style.boxShadow = '';
          }
        }, 1000);
      }
    }
    
    console.log(`AI : Backend overlay ${overlayObject.id} converted to local copy with visual refresh`);
  }
  
  // AI : Always save to history and database when moved
  saveToHistory(overlayObject);
}