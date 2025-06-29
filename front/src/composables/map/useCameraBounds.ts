import { ref } from 'vue';
import { map } from '@composables/core/useMap';
import type { CameraBounds } from '@types';

// AI : Current camera bounds for view mode
const currentCameraBounds = ref<CameraBounds | null>(null);

// AI : Callbacks to call when camera stops moving
const onCameraStopCallbacks: Array<(bounds: CameraBounds) => void> = [];

/**
 * AI : Initialize camera bounds tracking
 */
export function initializeCameraBounds() {
  if (!map.value) {
    console.warn('Map not available for camera bounds tracking');
    return;
  }
  
  
  // AI : Update bounds when map moves or zooms
  const updateBounds = () => {
    if (!map.value) {
      console.warn('Map not available in updateBounds');
      return;
    }
    
    try {
      const bounds = map.value.getBounds();
      if (!bounds) {
        console.warn('Map bounds not available');
        return;
      }
      
      const zoom = map.value.getZoom();
      if (zoom === undefined || zoom === null) {
        console.warn('Map zoom not available');
        return;
      }
      
      const newBounds: CameraBounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: zoom
      };
        currentCameraBounds.value = newBounds;
          
      // AI : Call all registered callbacks when camera stops moving
      onCameraStopCallbacks.forEach(callback => callback(newBounds));
    } catch (error) {
      console.error('Error updating camera bounds:', error);
    }
  };  // AI : Set initial bounds immediately - no delay needed as map is ready
  updateBounds();

  // AI : Listen for map events - these fire when camera stops moving
  map.value.on('load', updateBounds);
  map.value.on('moveend', updateBounds);
  map.value.on('zoomend', updateBounds);
}

/**
 * AI : Get current camera bounds
 */
export function getCameraBounds() {
  return currentCameraBounds;
}

/**
 * AI : Register callback to be called when camera stops moving
 */
export function onCameraStop(callback: (bounds: CameraBounds) => void) {
  onCameraStopCallbacks.push(callback);
  
  // AI : Return unsubscribe function
  return () => {
    const index = onCameraStopCallbacks.indexOf(callback);
    if (index > -1) {
      onCameraStopCallbacks.splice(index, 1);
    }
  };
}

/**
 * AI : Manually update camera bounds (useful for testing)
 */
export function updateCameraBounds(bounds: CameraBounds) {
  currentCameraBounds.value = bounds;
}
