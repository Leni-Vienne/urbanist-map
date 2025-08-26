// AI : Combined overlay modes management - handles both edit and view modes
import { watch } from 'vue';
import L from 'leaflet';
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap';
import { onCameraStop } from '@composables/map/useCameraBounds';
import { updateOverlayEditingState, clearAllOverlays, renderViewModeOverlays, updateMarkerTooltip, createOverlay } from '@composables/overlay/useOverlay';
import { createColorIcon } from '@composables/ui/markerIcons';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { storeToRefs } from 'pinia';
import type { CameraBounds, OverlayObject, CDNOverlayData } from '@types';

// AI : Function to get store refs when needed to avoid module-level initialization
function getStoreRefs() {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const { overlays, loadedEditOverlays, viewModeOverlays, overlaysLoading, overlaysError, isEditMode } = storeToRefs(overlayStore);
  const { projects } = storeToRefs(projectStore);
  return { 
    overlays, 
    projects, 
    loadedEditOverlays, 
    viewModeOverlays, 
    overlaysLoading, 
    overlaysError, 
    isEditMode,
    overlayStore 
  };
}

// AI : Constants for edit mode
const EDIT_MODE_LOAD_DISTANCE = 1000; // 1km - closer than view mode since edit mode needs more precision
const MIN_ZOOM_FOR_EDIT_OVERLAYS = 12; // AI : Minimum zoom level to load full overlays in edit mode

// AI : Layer group for overlay markers in edit mode
let editModeOverlayMarkers: L.LayerGroup | null = null;

// AI : Track camera subscription
let unsubscribeFromCamera: (() => void) | null = null;

// ================================
// EDIT MODE FUNCTIONS
// ================================

/**
 * AI : Initialize edit mode overlay markers - show markers for all overlays without images
 */
export function initializeEditModeOverlays(): void {
  if (!map.value) {
    onMapInitialized(() => {
      initializeEditModeOverlaysInternal();
    });
    return;
  }
  initializeEditModeOverlaysInternal();
}

/**
 * AI : Internal function to initialize edit mode overlay markers
 */
function initializeEditModeOverlaysInternal(): void {
  if (!map.value) return;

  // AI : Clear existing markers and overlays
  clearEditModeOverlays();

  // AI : Create new layer group for overlay markers
  editModeOverlayMarkers = L.layerGroup();

  // AI : Add markers for overlays that don't have images loaded yet
  const { overlays } = getStoreRefs();
  Object.values(overlays.value).forEach(overlay => {
    if (overlay.corners && overlay.corners.length >= 4 && !overlay.overlay) {
      // AI : Only create markers for overlays that don't have images loaded yet
      createEditModeOverlayMarker(overlay);
    }
  });

  // AI : Add markers to map
  if (editModeOverlayMarkers) {
    editModeOverlayMarkers.addTo(map.value);
  }

  // AI : Update tooltips based on current zoom level
  updateTooltipsForZoomLevel();
}

/**
 * AI : Create a marker for an overlay in edit mode
 */
function createEditModeOverlayMarker(overlay: OverlayObject): void {
  if (!map.value || !overlay.corners || !editModeOverlayMarkers) return;

  // AI : Calculate center point from corners - Leaflet distortable uses: NW, NE, SW, SE
  // AI : Center should be between NW (corners[0]) and SE (corners[3])
  const centerLat = (overlay.corners[0].lat + overlay.corners[3].lat) / 2;
  const centerLng = (overlay.corners[0].lng + overlay.corners[3].lng) / 2;

  // AI : Get marker color based on edit mode storage status
  const markerColor = getOverlayMarkerColor(overlay, 'edit');
  const markerIcon = createColorIcon(markerColor);

  // AI : Create marker with overlay ID stored for later reference
  const marker = L.marker([centerLat, centerLng], { icon: markerIcon }) as any;
  marker.overlayId = overlay.id;

  // AI : Add tooltip with overlay info
  const { projects } = getStoreRefs();
  const project = overlay.projectId ? projects.value[overlay.projectId] : null;
  const currentZoom = currentZoomLevel.value;
  const tooltipContent = `
    <div>
      <strong>${overlay.caption ?? 'Overlay'}</strong><br>
      Project: ${project?.name ?? 'Unknown'}<br>
      <small>${currentZoom < MIN_ZOOM_FOR_EDIT_OVERLAYS ? 
        `Zoom to level ${MIN_ZOOM_FOR_EDIT_OVERLAYS}+ to load overlay` : 
        'Click to load full overlay'}</small>
    </div>
  `;
  marker.bindTooltip(tooltipContent, {
    permanent: false,
    direction: 'top',
    offset: [0, -10]
  });

  // AI : Add click handler to load full overlay
  marker.on('click', () => {
    loadFullOverlay(overlay.id);
  });

  // AI : Add marker to layer group
  editModeOverlayMarkers.addLayer(marker);
}

/**
 * AI : Load full overlay image for a specific overlay
 */
async function loadFullOverlay(overlayId: string): Promise<void> {
  const { overlays, loadedEditOverlays, overlayStore } = getStoreRefs();
  const overlay = overlays.value[overlayId];
  
  if (!overlay || loadedEditOverlays.value.has(overlayId)) {
    return;
  }

  // AI : Check if zoom level is sufficient to load full overlay
  if (!map.value || currentZoomLevel.value < MIN_ZOOM_FOR_EDIT_OVERLAYS) {
    return;
  }

  try {
    // AI : Mark as loaded to prevent duplicate loading using store action
    overlayStore.addEditModeOverlay(overlayId);

    // AI : Load the full overlay by triggering its display
    // AI : In edit mode, we need to ensure the overlay is loaded and visible
    // AI : Load the overlay if not already loaded - create the overlay if it doesn't exist
    if (!overlay.overlay) {
      const newOverlay = await createOverlay(overlay.imageUrl, overlay);
      if (newOverlay) {
        overlay.overlay = newOverlay;
      }
    } else if (overlay.overlay && map.value) {
      // AI : If already loaded, just make sure it's visible on the map
      overlay.overlay.addTo(map.value);
    }

  } catch (error) {
    console.error(`AI : Error loading full overlay ${overlayId}:`, error);
    // AI : Remove from loaded set if loading failed using store action
    const { overlayStore } = getStoreRefs();
    overlayStore.removeEditModeOverlay(overlayId);
  }
}

/**
 * AI : Start camera tracking for edit mode - load nearby overlays when camera moves
 */
export function startEditModeTracking(): void {
  if (!map.value) return;

  // AI : Subscribe to camera stop events
  unsubscribeFromCamera = onCameraStop(handleCameraStop);
}

/**
 * AI : Stop camera tracking for edit mode
 */
export function stopEditModeTracking(): void {
  if (unsubscribeFromCamera) {
    unsubscribeFromCamera();
    unsubscribeFromCamera = null;
  }
}

/**
 * AI : Handle camera stop events - load nearby overlays if zoom is high enough
 */
async function handleCameraStop(_bounds: CameraBounds): Promise<void> {
  if (!map.value) return;

  const currentZoom = currentZoomLevel.value;
  
  // AI : Only load full overlays if zoom is high enough
  if (currentZoom < MIN_ZOOM_FOR_EDIT_OVERLAYS) {
    return;
  }

  // AI : Get camera center for distance calculations
  const center = map.value.getCenter();

  // AI : Find overlays within loading distance
  const overlaysToLoad: string[] = [];
  
  const { overlays, loadedEditOverlays } = getStoreRefs();
  Object.values(overlays.value).forEach(overlay => {
    if (!overlay.corners || overlay.corners.length < 4 || loadedEditOverlays.value.has(overlay.id)) {
      return;
    }

    // AI : Calculate distance to overlay center - Leaflet distortable uses: NW, NE, SW, SE
    // AI : Center should be between NW (corners[0]) and SE (corners[3])
    const centerLat = (overlay.corners[0].lat + overlay.corners[3].lat) / 2;
    const centerLng = (overlay.corners[0].lng + overlay.corners[3].lng) / 2;
    const overlayCenter = L.latLng(centerLat, centerLng);
    const distance = center.distanceTo(overlayCenter);

    // AI : Load if within distance threshold
    if (distance <= EDIT_MODE_LOAD_DISTANCE) {
      overlaysToLoad.push(overlay.id);
    }
  });

  // AI : Load the nearby overlays
  for (const overlayId of overlaysToLoad) {
    await loadFullOverlay(overlayId);
  }
}

/**
 * AI : Clear all edit mode overlays and markers
 */
export function clearEditModeOverlays(): void {
  // AI : Remove overlay markers from map
  if (map.value && editModeOverlayMarkers) {
    map.value.removeLayer(editModeOverlayMarkers);
    editModeOverlayMarkers = null;
  }

  // AI : Clear loaded overlays tracking using store action
  const { overlayStore } = getStoreRefs();
  overlayStore.clearEditModeOverlays();

  // AI : Only clear overlays when switching back to view mode
  // AI : Don't clear all overlays here - let the mode switching handle it
}

/**
 * AI : Clear all edit mode overlays and markers including full overlays
 */
export function clearAllEditModeOverlays(): void {
  // AI : Clear markers first
  if (map.value && editModeOverlayMarkers) {
    map.value.removeLayer(editModeOverlayMarkers);
    editModeOverlayMarkers = null;
  }

  // AI : Clear loaded overlays tracking using store action
  const { overlayStore } = getStoreRefs();
  overlayStore.clearEditModeOverlays();

  // AI : Clear full overlays from map
  clearAllOverlays();
}

/**
 * AI : Add a new overlay marker when an overlay is created
 */
export function addEditModeOverlayMarker(overlay: OverlayObject): void {
  if (!editModeOverlayMarkers) return;

  createEditModeOverlayMarker(overlay);
}

/**
 * AI : Remove an overlay marker when an overlay is deleted
 */
export function removeEditModeOverlayMarker(overlayId: string): void {
  if (!editModeOverlayMarkers) return;

  // AI : Find and remove the marker
  const markersLayer = editModeOverlayMarkers;
  markersLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker && (layer as any).overlayId === overlayId) {
      markersLayer.removeLayer(layer);
    }
  });

  // AI : Remove from loaded set using store action
  const { overlayStore } = getStoreRefs();
  overlayStore.removeEditModeOverlay(overlayId);
}

/**
 * AI : Update tooltips based on current zoom level
 */
function updateTooltipsForZoomLevel(): void {
  if (!editModeOverlayMarkers) return;

  const currentZoom = currentZoomLevel.value;
  
  editModeOverlayMarkers.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      const marker = layer as any;
      const overlayId = marker.overlayId;
      const { overlays, projects } = getStoreRefs();
      const overlay = overlays.value[overlayId];
      
      if (overlay) {
        const project = overlay.projectId ? projects.value[overlay.projectId] : null;
        const tooltipContent = `
          <div>
            <strong>${overlay.caption ?? 'Overlay'}</strong><br>
            Project: ${project?.name ?? 'Unknown'}<br>
            <small>${currentZoom < MIN_ZOOM_FOR_EDIT_OVERLAYS ? 
              `Zoom to level ${MIN_ZOOM_FOR_EDIT_OVERLAYS}+ to load overlay` : 
              'Click to load full overlay'}</small>
          </div>
        `;
        
        // AI : Update tooltip content
        marker.unbindTooltip();
        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -10]
        });
      }
    }
  });
}

/**
 * AI : Unload overlays when zoom level is too low
 */
function unloadOverlaysForZoomLevel(): void {
  if (currentZoomLevel.value < MIN_ZOOM_FOR_EDIT_OVERLAYS) {
    // AI : Clear all loaded overlays but keep markers
    clearAllOverlays();
    const { overlayStore } = getStoreRefs();
    overlayStore.clearEditModeOverlays();
  }
}

/**
 * AI : Watch for zoom level changes
 */
function watchZoomLevel(): void {
  watch(currentZoomLevel, (newZoom, oldZoom) => {
    // AI : Update tooltips when zoom changes
    updateTooltipsForZoomLevel();
    
    // AI : Unload overlays if zoom is too low
    if (newZoom < MIN_ZOOM_FOR_EDIT_OVERLAYS && oldZoom >= MIN_ZOOM_FOR_EDIT_OVERLAYS) {
      unloadOverlaysForZoomLevel();
    }
  });
}

/**
 * AI : Watch for changes in the overlays store and update markers accordingly
 */
function watchOverlayChanges(): void {
  const { overlays } = getStoreRefs();
  watch(overlays, (newOverlays, oldOverlays) => {
    // AI : Check for new overlays
    Object.keys(newOverlays).forEach(overlayId => {
      if (!oldOverlays[overlayId] && newOverlays[overlayId]) {
        // AI : New overlay added
        addEditModeOverlayMarker(newOverlays[overlayId]);
      }
    });

    // AI : Check for removed overlays
    Object.keys(oldOverlays).forEach(overlayId => {
      if (!newOverlays[overlayId] && oldOverlays[overlayId]) {
        // AI : Overlay removed
        removeEditModeOverlayMarker(overlayId);
      }
    });
  }, { deep: true });
}

// ================================
// VIEW MODE FUNCTIONS
// ================================

/**
 * AI : Stop camera tracking for view mode
 */
function stopViewModeTracking() {
  // AI : Clear view mode overlays state using store action
  const { overlayStore } = getStoreRefs();
  overlayStore.clearViewModeOverlays();
}

/**
 * AI : Set overlays loaded from city markers
 */
function setViewModeOverlays(overlays: CDNOverlayData[]) {
  const { overlayStore } = getStoreRefs();
  overlayStore.setViewModeOverlays(overlays);
  // AI : Do not automatically render overlays - let the caller handle rendering
  // AI : This prevents double-rendering when switching cities
}

/**
 * AI : Render all current overlays in view mode
 */
async function renderCurrentOverlays() {
  const { viewModeOverlays, overlayStore } = getStoreRefs();
  
  if (viewModeOverlays.value.length === 0) return;
  
  overlayStore.setOverlaysLoading(true);

  try {
    // AI : Render all overlays - no filtering needed since overlays are already city-specific
    await renderViewModeOverlays(viewModeOverlays.value);
  } catch (err) {
    console.error('Error rendering overlays:', err);
    overlayStore.setOverlaysError('Failed to render overlays');
  } finally {
    overlayStore.setOverlaysLoading(false);
  }
}

/**
 * AI : Clear view mode overlays
 */
function clearViewModeOverlays() {
  const { overlayStore } = getStoreRefs();
  overlayStore.clearViewModeOverlays();
  // AI : Don't call clearAllOverlays here - let the mode switching handle it
}

// ================================
// MODE SWITCHING LOGIC
// ================================

/**
 * AI : Toggle between edit and view modes
 * @param onModeExit - Optional callback function to handle city-specific logic when exiting edit mode
 */
export async function toggleEditMode(onModeExit?: () => Promise<void>): Promise<void> {
  // AI : Get store refs when needed to avoid module-level initialization
  const { overlays, isEditMode } = getStoreRefs();
  
  isEditMode.value = !isEditMode.value;

  if (isEditMode.value) {
    // AI : ENTERING EDIT MODE
    // AI : Stop view mode tracking
    stopViewModeTracking();
    
    // AI : For overlays that already have images loaded (from city markers), 
    // AI : ensure they're properly added to the map and update their editing state
    Object.values(overlays.value).forEach((overlayObject) => {
      if (overlayObject.overlay && map.value) {
        // AI : Make sure the overlay is added to the map
        if (!map.value.hasLayer(overlayObject.overlay)) {
          overlayObject.overlay.addTo(map.value);
        }
      }
      
      // AI : Update marker colors and tooltips for edit mode
      if (overlayObject.marker) {
        updateMarkerTooltip(overlayObject);
      }
    });
    
    // AI : Update overlay editing state for existing overlays
    updateOverlayEditingState();
    
    // AI : Initialize edit mode overlay markers for overlays that don't have images loaded yet
    initializeEditModeOverlays();
    
    // AI : Start camera tracking for edit mode
    startEditModeTracking();
  } else {
    // AI : EXITING EDIT MODE
    // AI : Stop edit mode tracking
    stopEditModeTracking();
    
    // AI : Clear only the edit mode markers, not the full overlays
    clearEditModeOverlays();
    
    // AI : Update markers for view mode (remove tooltips, update colors)
    Object.values(overlays.value).forEach((overlayObject) => {
      if (overlayObject.marker) {
        updateMarkerTooltip(overlayObject);
      }
    });
    
    // AI : Update overlay editing state for existing overlays (disable editing)
    updateOverlayEditingState();
    
    // AI : Call city-specific exit logic if provided
    if (onModeExit) {
      await onModeExit();
    }
  }
}

// ================================
// COMPOSABLE FUNCTIONS
// ================================

/**
 * AI : Composable to manage view mode overlays
 */
export function useViewModeOverlays() {
  const { viewModeOverlays, overlaysLoading, overlaysError } = getStoreRefs();

  return {
    // AI : Reactive state from store
    viewModeOverlays,
    loading: overlaysLoading,
    error: overlaysError,

    // AI : Methods
    renderCurrentOverlays,
    setViewModeOverlays,
    stopCameraTracking: stopViewModeTracking,
    clearOverlays: clearViewModeOverlays
  };
}

/**
 * AI : Composable to manage edit mode overlays
 */
export function useEditModeOverlays() {
  const { loadedEditOverlays } = getStoreRefs();
  
  return {
    // AI : State
    loadedEditOverlays: loadedEditOverlays,

    // AI : Methods
    initializeEditModeOverlays,
    startEditModeTracking,
    stopEditModeTracking,
    clearEditModeOverlays,
    clearAllEditModeOverlays,
    addEditModeOverlayMarker,
    removeEditModeOverlayMarker,
    loadFullOverlay
  };
}

// AI : Initialize watch when this module is imported
onMapInitialized(() => {
  watchOverlayChanges();
  watchZoomLevel();
});