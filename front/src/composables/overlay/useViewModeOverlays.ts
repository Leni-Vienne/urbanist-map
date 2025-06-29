import { ref } from 'vue';
import { onCameraStop } from '@composables/map/useCameraBounds';
import { renderViewModeOverlays } from '@composables/overlay/useOverlay';
import type { CDNOverlayData, CameraBounds } from '@types';

// AI : Reactive state for view mode overlays
const viewModeOverlays = ref<CDNOverlayData[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/**
 * AI : Composable to manage overlays in view mode
 */
export function useViewModeOverlays() {
  let unsubscribeFromCamera: (() => void) | null = null;
  // This is used for performance optimization to avoid rendering too many overlays at once
  async function fetchIntersectingOverlays(bounds: CameraBounds) {
    loading.value = true;
    error.value = null;

    try {

      // AI : Use local filtering only - overlays are already loaded from city markers
      // This function now only filters visible overlays for performance optimization
      const currentOverlays = viewModeOverlays.value;

      // AI : Filter overlays that intersect with the current camera bounds
      const visibleOverlays = currentOverlays.filter(overlay => {
        // AI : Check if overlay centroid is within bounds
        return overlay.centroid.lat >= bounds.south &&
          overlay.centroid.lat <= bounds.north &&
          overlay.centroid.lng >= bounds.west &&
          overlay.centroid.lng <= bounds.east;
      });


      // AI : Render only the visible overlays for performance
      await renderViewModeOverlays(visibleOverlays);
    } catch (err) {
      console.error('Error filtering overlays locally:', err);
      error.value = 'Failed to filter overlays';
    } finally {
      loading.value = false;
    }
  }// AI : Initialize camera tracking but don't auto-fetch overlays
  function startCameraTracking() {
    unsubscribeFromCamera = onCameraStop(fetchIntersectingOverlays);

    // AI : Don't auto-fetch overlays on camera tracking start
    // Overlays will only be loaded when user clicks on city markers
  }// AI : Stop camera tracking
  function stopCameraTracking() {
    if (unsubscribeFromCamera) {
      unsubscribeFromCamera();
      unsubscribeFromCamera = null;
    }

    // AI : Clear only the view mode overlays state - let the main overlay system handle map cleanup
    viewModeOverlays.value = [];
    error.value = null;
  }
  // AI : Set overlays loaded from city markers
  function setViewModeOverlays(overlays: CDNOverlayData[]) {
    viewModeOverlays.value = overlays;
  }

  // AI : Clear overlays
  function clearOverlays() {
    viewModeOverlays.value = [];
    error.value = null;
    // AI : Don't call clearAllOverlays here - let the mode switching handle it
  }

  return {
    // AI : Reactive state
    viewModeOverlays,
    loading,
    error,

    // AI : Methods
    fetchIntersectingOverlays,
    setViewModeOverlays,
    startCameraTracking,
    stopCameraTracking,
    clearOverlays
  };
}
