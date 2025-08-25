// AI : Simplified edit mode management
import { updateOverlayEditingState, clearAllOverlays, renderViewModeOverlays, updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { initializeEditModeOverlays, clearEditModeOverlays, startEditModeTracking, stopEditModeTracking } from '@composables/overlay/useEditModeOverlays';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { latestClickedCity, getCachedCityProjectsData, hasCachedCityProjectsData, renderOverlayMarkersFromCache, MIN_ZOOM_FOR_OVERLAYS, updateOverlayMarkersForFilters } from '@composables/map/useCityMarkers';
import { map } from '@composables/core/useMap';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';

/**
 * AI : Toggle between edit and view modes
 */
export async function toggleEditMode(): Promise<void> {
  // AI : Get store refs when needed to avoid module-level initialization
  const overlayStore = useOverlayStore();
  const { overlays, isEditMode } = storeToRefs(overlayStore);
  
  isEditMode.value = !isEditMode.value;

  if (isEditMode.value) {
    // AI : Stop view mode tracking
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();
    
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
    
    // AI : Update overlay markers colors for edit mode (when zoomed out)
    updateOverlayMarkersForFilters();
    
    // AI : Start camera tracking for edit mode
    startEditModeTracking();
  } else {
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
    
    // AI : Force re-render overlays to show original backend positions instead of modified ones
    // AI : Check if we have a current city with cached data
    if (latestClickedCity.value && hasCachedCityProjectsData(latestClickedCity.value.id)) {
      const overlaysData = getCachedCityProjectsData(latestClickedCity.value.id)!;;;
      
      // AI : Clear all current overlays first
      clearAllOverlays();
      
      // AI : Check current zoom level to decide what to render
      const currentZoom = map.value?.getZoom() ?? 0;
      
      if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS) {
        // AI : Zoom is high enough for full overlays
        const { setViewModeOverlays } = useViewModeOverlays();
        setViewModeOverlays(overlaysData);
        
        // AI : Render the overlays on the map
        renderViewModeOverlays(overlaysData, true, true).catch((error: any) => {
          console.error('AI : Error re-rendering overlays in view mode:', error);
        });
      } else {
        // AI : Zoom is too low, render markers only (view mode markers)
        renderOverlayMarkersFromCache(latestClickedCity.value.id, latestClickedCity.value.name);
      }
      
      // AI : Update overlay markers colors for view mode (when zoomed out)
      updateOverlayMarkersForFilters();
    } else {
      // AI : No city data available, just update editing state for existing overlays
      Object.values(overlays.value).forEach((overlayObject) => {
        if (overlayObject.overlay && map.value) {
          // AI : Make sure the overlay is still on the map
          if (!map.value.hasLayer(overlayObject.overlay)) {
            overlayObject.overlay.addTo(map.value);
          }
        }
      });
      
      // AI : Update overlay editing state for existing overlays (disable editing)
      updateOverlayEditingState();
    }
  }
}