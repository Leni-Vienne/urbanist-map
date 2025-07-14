// AI : Simplified edit mode management
import { overlays, updateOverlayEditingState, clearAllOverlays, renderViewModeOverlays } from '@composables/overlay/useOverlay';
import { isEditMode } from '@stores/overlayStore';
import { initializeEditModeOverlays, clearEditModeOverlays, startEditModeTracking, stopEditModeTracking } from '@composables/overlay/useEditModeOverlays';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { latestClickedCity, getCachedCityProjectsData, hasCachedCityProjectsData, renderOverlayMarkersFromCache, MIN_ZOOM_FOR_OVERLAYS } from '@composables/map/useCityMarkers';
import { map } from '@composables/core/useMap';

/**
 * AI : Toggle between edit and view modes
 */
export async function toggleEditMode(): Promise<void> {
  isEditMode.value = !isEditMode.value;

  if (isEditMode.value) {
    // AI : Switch to edit mode
    console.log('AI : Switched to edit mode');
    
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
    });
    
    // AI : Update overlay editing state for existing overlays
    updateOverlayEditingState();
    
    // AI : Initialize edit mode overlay markers for overlays that don't have images loaded yet
    initializeEditModeOverlays();
    
    // AI : Start camera tracking for edit mode
    startEditModeTracking();
  } else {
    // AI : Switch to view mode
    console.log('AI : Switched to view mode');
    
    // AI : Stop edit mode tracking
    stopEditModeTracking();
    
    // AI : Clear only the edit mode markers, not the full overlays
    clearEditModeOverlays();
    
    // AI : Force re-render overlays to show original backend positions instead of modified ones
    // AI : Check if we have a current city with cached data
    if (latestClickedCity && hasCachedCityProjectsData(latestClickedCity.id)) {
      const overlaysData = getCachedCityProjectsData(latestClickedCity.id)!;
      
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
        renderOverlayMarkersFromCache(latestClickedCity.id, latestClickedCity.name);
      }
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

/**
 * AI : Set edit mode state without toggling
 */
export function setEditMode(editMode: boolean): void {
  isEditMode.value = editMode;
}

// AI : Re-export isEditMode for convenience
export { isEditMode };
