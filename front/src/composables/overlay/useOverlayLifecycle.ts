// AI : Overlay lifecycle management - extracted to break circular dependencies
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { clearOverlaysBeingCreated } from "@/composables/overlay/useOverlay";

/**
 * AI : Clear all overlays from the map and reset collections
 * AI : NOTE: Does NOT clear viewModeOverlays cache - that's managed by viewport loading
 * @param preserveStoreData - If true, only removes Leaflet layers but keeps overlay data in store
 *                            Useful for zoom transitions where we need to restore overlays later
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  // AI : CRITICAL FIX: Remove ALL DistortableImageOverlay instances from map
  // AI : This catches duplicates created when renderSingleOverlay is called multiple times
  // AI : before onAddedToMap callback completes (two separate Leaflet objects for same overlay ID)
  const overlaysToRemove: L.Layer[] = [];
  map.value.eachLayer((layer) => {
    // @ts-ignore - L.DistortableImageOverlay exists but isn't in types
    if (layer instanceof L.DistortableImageOverlay) {
      overlaysToRemove.push(layer);
    }
  });

  for (const layer of overlaysToRemove) {
    map.value.removeLayer(layer);
  }

  // AI : Clear in-progress tracking to prevent stale entries
  clearOverlaysBeingCreated();

  // AI : Collect IDs for markers that need to be cleared from allMarkers cache
  const markerIdsToClear: string[] = [];

  // AI : Clean up store-tracked overlays and their markers
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    // AI : Markers are not DistortableImageOverlay, so remove them separately
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
