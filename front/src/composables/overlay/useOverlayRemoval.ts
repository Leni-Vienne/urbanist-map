// AI : Overlay removal utilities - extracted to break circular dependency
// AI : This file contains low-level overlay removal logic that can be imported
// AI : by both useOverlay.ts and useUserContributions.ts

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { map } from "@/composables/core/useMap";

/**
 * AI : Remove a specific overlay from the map and collections
 * AI : This only handles local cleanup - does NOT call backend API
 */
export function removeOverlayFromMap(overlayId: string): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  if (overlayObject.overlay) {
    map.value.removeLayer(overlayObject.overlay);
  }

  if (overlayObject.marker) {
    map.value.removeLayer(overlayObject.marker);
  }

  delete overlayStore.overlays[overlayId];
  delete overlayStore.allMarkers[overlayId];

  if (overlayStore.idSelectedOverlay === overlayId) {
    overlayStore.idSelectedOverlay = null;
  }
}
