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
  console.log('useViewModeOverlays initialized');  // AI : Filter already loaded overlays that intersect with camera bounds
  // This is used for performance optimization to avoid rendering too many overlays at once
  async function fetchIntersectingOverlays(bounds: CameraBounds) {
    loading.value = true;
    error.value = null;

    try {
      console.log('AI : Filtering overlays locally based on camera bounds for performance');

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

      console.log(`AI : Filtered ${visibleOverlays.length} overlays from ${currentOverlays.length} total overlays`);

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
    console.log('startCameraTracking called');
    unsubscribeFromCamera = onCameraStop(fetchIntersectingOverlays);
    console.log('Camera tracking started successfully');

    // AI : Don't auto-fetch overlays on camera tracking start
    // Overlays will only be loaded when user clicks on city markers
    console.log('AI : Camera tracking started without auto-fetching overlays');
  }// AI : Stop camera tracking
  function stopCameraTracking() {
    console.log('stopCameraTracking called');
    if (unsubscribeFromCamera) {
      unsubscribeFromCamera();
      unsubscribeFromCamera = null;
      console.log('Camera tracking stopped successfully');
    }

    // AI : Clear only the view mode overlays state - let the main overlay system handle map cleanup
    viewModeOverlays.value = [];
    error.value = null;
  }
  // AI : Set overlays loaded from city markers
  function setViewModeOverlays(overlays: CDNOverlayData[]) {
    viewModeOverlays.value = overlays;
    console.log(`AI : Set ${overlays.length} overlays for view mode from city markers`);
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
