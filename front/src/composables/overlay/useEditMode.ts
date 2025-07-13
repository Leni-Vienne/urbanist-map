// AI : Simplified edit mode management
import { overlays, updateOverlayEditingState } from '@composables/overlay/useOverlay';
import { isEditMode } from '@stores/overlayStore';
import { initializeEditModeOverlays, clearEditModeOverlays, startEditModeTracking, stopEditModeTracking } from '@composables/overlay/useEditModeOverlays';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
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
    
    // AI : For overlays that have images loaded, keep them but update their editing state
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

/**
 * AI : Set edit mode state without toggling
 */
export function setEditMode(editMode: boolean): void {
  isEditMode.value = editMode;
}

// AI : Re-export isEditMode for convenience
export { isEditMode };
