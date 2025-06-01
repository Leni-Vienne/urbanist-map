import { ref, onUnmounted } from 'vue';
import { onCameraStop, getCameraBounds } from '@composables/map/useCameraBounds';
import { renderViewModeOverlays } from '@composables/overlay/useOverlay';
import { trpc } from '../../client';
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
  console.log('useViewModeOverlays initialized');  // AI : Fetch overlays that intersect with camera bounds
  async function fetchIntersectingOverlays(bounds: CameraBounds) {
    loading.value = true;
    error.value = null;
    
    try {
      const result = await trpc.overlay.getIntersectingOverlays.query({
        north: bounds.north,
        south: bounds.south,
        east: bounds.east,
        west: bounds.west
      });
      
      viewModeOverlays.value = result.overlays;
      
      // AI : Render the overlays on the map
      await renderViewModeOverlays(result.overlays);
    } catch (err) {
      console.error('Error fetching intersecting overlays:', err);
      error.value = 'Failed to load overlays in view';
      viewModeOverlays.value = [];
    } finally {
      loading.value = false;
    }
  }  // AI : Initialize camera tracking
  function startCameraTracking() {
    console.log('startCameraTracking called');
    unsubscribeFromCamera = onCameraStop(fetchIntersectingOverlays);
    console.log('Camera tracking started successfully');
    
    // AI : Fetch overlays for current camera position - no delay needed
    const currentBounds = getCameraBounds();
    if (currentBounds.value) {
      console.log('AI : Fetching overlays for current camera position on view mode switch');
      fetchIntersectingOverlays(currentBounds.value);
    } else {
      console.log('AI : No current camera bounds available for initial overlay fetch');
    }
  }  // AI : Stop camera tracking
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

  // AI : Clear overlays
  function clearOverlays() {
    viewModeOverlays.value = [];
    error.value = null;
    // AI : Don't call clearAllOverlays here - let the mode switching handle it
  }

  // AI : Auto-cleanup on unmount
  onUnmounted(() => {
    stopCameraTracking();
  });

  return {
    // AI : Reactive state
    viewModeOverlays,
    loading,
    error,
    
    // AI : Methods
    fetchIntersectingOverlays,
    startCameraTracking,
    stopCameraTracking,
    clearOverlays
  };
}
