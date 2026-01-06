// AI : Overlay lifecycle management - extracted to break circular dependencies
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * AI : Clear all overlays from the map and reset collections
 * AI : NOTE: Does NOT clear viewModeOverlays cache - that's managed by viewport loading
 */
export function clearAllOverlays(): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  for (const overlayObject of Object.values(overlayStore.overlays)) {
    // AI : Only remove layers that are actually on the map to prevent errors
    // AI : This fixes ghost overlay bug where overlay was added to store but not to map yet
    if (overlayObject.overlay && map.value?.hasLayer(overlayObject.overlay)) {
      map.value.removeLayer(overlayObject.overlay);
    }
    if (overlayObject.marker && map.value?.hasLayer(overlayObject.marker)) {
      map.value.removeLayer(overlayObject.marker);
    }
  }

  overlayStore.overlays = {};
  overlayStore.allMarkers = {};

  if (overlayStore.idSelectedOverlay) {
    overlayStore.idSelectedOverlay = null;
  }
}
