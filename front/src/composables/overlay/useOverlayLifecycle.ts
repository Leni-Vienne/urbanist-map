// AI : Overlay lifecycle management - extracted to break circular dependencies
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import type { OverlayObject } from "@/types/index";

/**
 * AI : Clear all overlays from the map and reset collections
 */
export function clearAllOverlays(): void {
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();

  if (!map.value) return;

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.overlay) {
      map.value?.removeLayer(overlayObject.overlay);
    }
    if (overlayObject.marker) {
      map.value?.removeLayer(overlayObject.marker);
    }
  });

  overlayStore.overlays = {};
  overlayStore.allMarkers = {};

  if (overlayStore.idSelectedOverlay) {
    overlayStore.idSelectedOverlay = null;
  }
}
