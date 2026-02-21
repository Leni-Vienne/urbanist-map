// AI : Overlay lifecycle management - extracted to break circular dependencies
// AI : Also serves as the shared state hub for cross-chunk callback registration and creation tracking,
// AI : keeping these tiny primitives out of the lazy chunks (overlayRendering, overlayToolbar).
import L from "leaflet";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import type { OverlayObject } from "@/types/index";

// AI : Tracks overlay IDs currently being created to prevent duplicates during async image loads.
// AI : overlayRendering.ts uses .has()/.add()/.delete() directly; clearAllOverlays uses .clear().
export const overlaysBeingCreated = new Set<string>();

// AI : Cross-chunk callback registry. Modules in the initial bundle assign these at init time;
// AI : lazy chunks (overlayRendering, overlayToolbar) read them at call time.
// AI : Using a plain object so importers can mutate properties directly without ES module re-export restrictions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const overlayCallbacks: {
  // AI : Registered by overlay.ts (initial bundle); called from overlayRendering.ts (lazy chunk)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkOverlaySize: ((overlay: any, overlayObject: OverlayObject) => void) | null;
  // AI : Registered by overlayEditing.ts (initial bundle); called from overlayToolbar.ts (lazy chunk)
  focusCameraToOverlay: ((direction: "next" | "previous") => void) | null;
  undo: (() => void) | null;
  redo: (() => void) | null;
} = {
  checkOverlaySize: null,
  focusCameraToOverlay: null,
  undo: null,
  redo: null,
};

/**
 * AI : Clear all overlays from the map and reset collections
 * AI : NOTE: Does NOT clear viewModeOverlays cache - that's managed by viewport loading
 * @param preserveStoreData - If true, only removes Leaflet layers but keeps overlay data in store
 *                            Useful for zoom transitions where we need to restore overlays later
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  // AI : CRITICAL FIX: Remove ALL DistortableImageOverlay instances from map
  // AI : This catches duplicates created when renderSingleOverlay is called multiple times
  // AI : before onAddedToMap callback completes (two separate Leaflet objects for same overlay ID)
  const overlaysToRemove: L.Layer[] = [];
  map.value.eachLayer((layer) => {
    // @ts-ignore - L.DistortableImageOverlay may not be loaded yet (lazy chunk)
    if (L.DistortableImageOverlay && layer instanceof L.DistortableImageOverlay) {
      overlaysToRemove.push(layer);
    }
  });

  for (const layer of overlaysToRemove) {
    map.value.removeLayer(layer);
  }

  // AI : Clear in-progress tracking to prevent stale entries
  overlaysBeingCreated.clear();

  // AI : Collect IDs for markers that need to be cleared from allMarkers cache
  const markerIdsToClear: string[] = [];

  // AI : Clean up store-tracked overlays and their markers
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    // AI : Markers are not DistortableImageOverlay, so remove them separately
    if (overlayObject.marker && map.value.hasLayer(overlayObject.marker)) {
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
      if (map.value.hasLayer(marker)) {
        marker.remove();
      }
    }
    overlayStore.allMarkers = {};
  } else {
    // AI : Clear markers from allMarkers cache so they can be recreated
    overlayStore.clearMarkersFromCache(markerIdsToClear);
  }
}
