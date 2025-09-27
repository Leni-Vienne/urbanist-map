// AI : Combined overlay modes management - handles both edit and view modes
import { watch } from 'vue';
import L from 'leaflet';
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap';
import { updateOverlayEditingState, clearAllOverlays, renderViewModeOverlays, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { storeToRefs } from 'pinia';
import type { CDNOverlayData } from '@types';
import { latestClickedCity, hasCachedCityProjectsData, getCachedCityProjectsData } from '@composables/map/useCityData';
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';

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

  // AI : Clear existing edit mode UI
  clearEditModeUI();
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
 * AI : Clear all edit mode overlays and markers
 */
function clearEditModeUI(): void {
  // AI : Use store to clear both markers and state
  const { overlayStore } = getStoreRefs();
  overlayStore.clearEditModeMarkersAndState(map.value ?? undefined, editModeOverlayMarkers);

  // AI : Reset local marker reference
  editModeOverlayMarkers = null;
}

/**
 * AI : Update tooltips based on current zoom level
 */
function updateTooltipsForZoomLevel(): void {
  if (!editModeOverlayMarkers) return;

  const currentZoom = currentZoomLevel.value;

  editModeOverlayMarkers.eachLayer((marker) => {
    if (marker instanceof L.Marker) {
      const overlayId = marker.overlayId;
      if (!overlayId) return;
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
    // AI : Clear all loaded overlays but keep regular markers (they handle click-to-load)
    clearAllOverlays();
    const { overlayStore } = getStoreRefs();
    overlayStore.clearEditModeMarkersAndState();
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
 * AI : Handle edit mode exit - reset overlays to backend positions for view mode display
 * This function contains the city-related overlay re-rendering logic
 */
export function handleEditModeExit() {
  // AI : Force re-render overlays to show original backend positions instead of modified ones
  // AI : Check if we have a current city with cached data
  if (latestClickedCity.value && hasCachedCityProjectsData(latestClickedCity.value.id)) {
    const overlaysData = getCachedCityProjectsData(latestClickedCity.value.id)!;

    // AI : Get store refs for overlays
    const { overlays } = getStoreRefs();

    // AI : Check current zoom level to decide what to render
    const currentZoom = map.value?.getZoom() ?? 0;

    if (currentZoom >= MIN_ZOOM_FOR_EDIT_OVERLAYS) {
      // AI : Zoom is high enough for full overlays
      const { setViewModeOverlays } = useViewModeOverlays();
      setViewModeOverlays(overlaysData);

      // AI : Reset overlay positions to backend values for VIEW MODE DISPLAY ONLY
      // AI : DO NOT clear isModified or edit mode cache - these need to persist for edit mode restoration
      overlaysData.forEach(cdnOverlay => {
        const existingOverlay = overlays.value[cdnOverlay.id];
        if (existingOverlay?.overlay && cdnOverlay.corners?.length === 4) {
          // AI : Reset to backend corners (for view mode display only)
          const backendCorners = cdnOverlay.corners.map(corner => L.latLng(corner.lat, corner.lng));
          
          existingOverlay.overlay.setCorners(backendCorners);
          // AI : IMPORTANT: Do NOT clear isModified flag or edit mode cache
          // The edit mode cache must persist so positions can be restored when returning to edit mode
          
          // AI : Update marker position and tooltip
          updateMarkerPosition(existingOverlay);
          updateMarkerTooltip(existingOverlay);
        }
      });

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Only render new overlays that don't exist yet
      const existingOverlayIds = new Set(Object.keys(overlays.value));
      const newOverlays = visibleOverlays.filter(overlay => !existingOverlayIds.has(overlay.id));
      if (newOverlays.length > 0) {
        renderViewModeOverlays(newOverlays, true, false);
      }
    } else {
      // AI : Zoom is too low, clear overlays and render markers only
      clearAllOverlays();
      renderOverlayMarkersFromCache(latestClickedCity.value.id, latestClickedCity.value.name);
    }

    // AI : Update overlay markers colors for view mode (when zoomed out)
    updateOverlayMarkersForFilters();
  }
}

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
function renderCurrentOverlays() {
  const { viewModeOverlays, overlayStore } = getStoreRefs();

  if (viewModeOverlays.value.length === 0) return;

  overlayStore.setOverlaysLoading(true);

  try {
    // AI : Render all overlays - no filtering needed since overlays are already city-specific
    renderViewModeOverlays(viewModeOverlays.value);
  } catch (err) {
    console.error('Error rendering overlays:', err);
    overlayStore.setOverlaysError('Failed to render overlays');
  } finally {
    overlayStore.setOverlaysLoading(false);
  }
}

// ================================
// MODE SWITCHING LOGIC
// ================================

/**
 * AI : Toggle between edit and view modes
 * @param onModeExit - Optional callback function to handle city-specific logic when exiting edit mode
 */
export function toggleEditMode(onModeExit?: () => void) {
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
    });

    // AI : Update overlay editing state for existing overlays - this will recreate overlays with cached corners
    // and then update marker tooltips with correct positions
    updateOverlayEditingState();

    // AI : Initialize edit mode overlay markers for overlays that don't have images loaded yet
    initializeEditModeOverlays();

  } else {
    // AI : EXITING EDIT MODE
    // AI : Stop edit mode tracking
    stopEditModeTracking();

    // AI : Clear only the edit mode markers, not the full overlays
    clearEditModeUI();

    // AI : Update markers for view mode (remove tooltips, update colors)
    Object.values(overlays.value).forEach((overlayObject) => {
      if (overlayObject.marker) {
        updateMarkerTooltip(overlayObject);
      }
    });

    // AI : Update overlay editing state for existing overlays (disable editing)
    updateOverlayEditingState();

    // AI : Execute custom exit logic if provided
    if (onModeExit) {
      onModeExit();
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
  };
}

// AI : Initialize watch when this module is imported
onMapInitialized(() => {
  watchZoomLevel();
});
