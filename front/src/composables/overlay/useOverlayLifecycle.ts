// AI : Overlay lifecycle management - extracted to break circular dependencies
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * AI : Clear all overlays from the map and reset collections
 * AI : NOTE: Does NOT clear viewModeOverlays cache - that's managed by viewport loading
 * @param preserveStoreData - If true, only removes Leaflet layers but keeps overlay data in store
 *                            Useful for zoom transitions where we need to restore overlays later
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  // AI : Collect IDs for markers that need to be cleared from allMarkers cache
  const markerIdsToClear: string[] = [];

  for (const overlayObject of Object.values(overlayStore.overlays)) {
    // AI : Only remove layers that are actually on the map to prevent errors
    // AI : This fixes ghost overlay bug where overlay was added to store but not to map yet
    if (overlayObject.overlay && map.value?.hasLayer(overlayObject.overlay)) {
      map.value.removeLayer(overlayObject.overlay);
    }
    if (overlayObject.marker && map.value?.hasLayer(overlayObject.marker)) {
      map.value.removeLayer(overlayObject.marker);
    }

    // AI : If preserving store data, null out the Leaflet layer references
    // AI : This allows us to detect they need re-rendering when zooming back in
    if (preserveStoreData) {
      overlayObject.overlay = null;
      overlayObject.marker = null;
      // AI : Mark for removal from allMarkers so createSingleMarker can recreate on zoom-in
      markerIdsToClear.push(overlayObject.id);
    }
  }

  if (!preserveStoreData) {
    overlayStore.overlays = {};

    if (overlayStore.idSelectedOverlay) {
      overlayStore.idSelectedOverlay = null;
    }

    // AI : CRITICAL FIX: Explicitly remove all markers from map
    // AI : iterating overlayStore.overlays is not enough because some markers
    // AI : might be created (and in allMarkers) but not yet linked to an overlayObject in the store
    // AI : (e.g. during the async loading phase)
    for (const marker of Object.values(overlayStore.allMarkers)) {
      if (marker && map.value?.hasLayer(marker)) {
        marker.remove();
      }
    }
    overlayStore.allMarkers = {};
  } else {
    // AI : Clear markers from allMarkers cache so they can be recreated
    overlayStore.clearMarkersFromCache(markerIdsToClear);
  }
}
