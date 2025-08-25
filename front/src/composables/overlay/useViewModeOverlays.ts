import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import { renderViewModeOverlays } from '@composables/overlay/useOverlay';
import type { CDNOverlayData } from '@types';

/**
 * AI : Composable to manage overlays in view mode using centralized store
 */
export function useViewModeOverlays() {
  const overlayStore = useOverlayStore();
  const { viewModeOverlays, overlaysLoading, overlaysError } = storeToRefs(overlayStore);

  function stopCameraTracking() {
    // AI : Clear view mode overlays state using store action
    overlayStore.clearViewModeOverlays();
  }

  // AI : Set overlays loaded from city markers
  function setViewModeOverlays(overlays: CDNOverlayData[]) {
    overlayStore.setViewModeOverlays(overlays);
    // AI : Do not automatically render overlays - let the caller handle rendering
    // AI : This prevents double-rendering when switching cities
  }

  // AI : Render all current overlays
  async function renderCurrentOverlays() {
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

  // AI : Clear overlays
  function clearOverlays() {
    overlayStore.clearViewModeOverlays();
    // AI : Don't call clearAllOverlays here - let the mode switching handle it
  }

  return {
    // AI : Reactive state from store
    viewModeOverlays,
    loading: overlaysLoading,
    error: overlaysError,

    // AI : Methods
    renderCurrentOverlays,
    setViewModeOverlays,
    stopCameraTracking,
    clearOverlays
  };
}
