import { ref } from 'vue';
import { renderViewModeOverlays } from '@composables/overlay/useOverlay';
import type { CDNOverlayData } from '@types';

// AI : Reactive state for view mode overlays
const viewModeOverlays = ref<CDNOverlayData[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/**
 * AI : Composable to manage overlays in view mode
 */
export function useViewModeOverlays() {
  // AI : Simplified approach - no camera tracking needed for view mode
  // AI : Just render all overlays when they're set from city markers
  
  // AI : No-op functions for backward compatibility
  function startCameraTracking() {
    // AI : No longer needed - overlays are rendered directly when set
  }

  function stopCameraTracking() {
    // AI : Clear view mode overlays state
    viewModeOverlays.value = [];
    error.value = null;
  }
  // AI : Set overlays loaded from city markers
  function setViewModeOverlays(overlays: CDNOverlayData[]) {
    viewModeOverlays.value = overlays;
    // AI : Do not automatically render overlays - let the caller handle rendering
    // AI : This prevents double-rendering when switching cities
  }

  // AI : Render all current overlays
  async function renderCurrentOverlays() {
    if (viewModeOverlays.value.length === 0) return;
    
    loading.value = true;
    error.value = null;

    try {
      // AI : Render all overlays - no filtering needed since overlays are already city-specific
      await renderViewModeOverlays(viewModeOverlays.value);
    } catch (err) {
      console.error('Error rendering overlays:', err);
      error.value = 'Failed to render overlays';
    } finally {
      loading.value = false;
    }
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
    renderCurrentOverlays,
    setViewModeOverlays,
    startCameraTracking,
    stopCameraTracking,
    clearOverlays
  };
}
