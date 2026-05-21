import { useOverlayStore } from "@/stores/pinia/overlayStore";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";

// Cross-chunk callback registry. Modules in the initial bundle assign these at init time;
// lazy chunks (overlayRendering, overlayToolbar) read them at call time.
// Plain object so importers can mutate properties directly without ES module re-export restrictions.
export const overlayCallbacks: {
  // Registered by overlayActions.ts; called from overlayToolbar.ts (lazy chunk)
  focusCameraToOverlay: ((direction: "next" | "previous") => void) | null;
  undo: (() => void) | null;
  redo: (() => void) | null;
} = {
  focusCameraToOverlay: null,
  undo: null,
  redo: null,
};

/**
 * Clear all overlays from the map and reset collections.
 * Delegates Leaflet layer/marker cleanup to overlayRenderRegistry.
 * Does not clear viewModeOverlays, which is managed by viewport loading.
 * @param preserveStoreData - If true, only removes Leaflet image layers but keeps marker refs
 *                            and overlay data in store. Used for zoom threshold crossings.
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  // registry.clearAll handles all Leaflet cleanup, no need to iterate map.eachLayer()
  // because the registry is the canonical source of all live layers (created via beginCreation).
  registry.clearAll(preserveStoreData);

  if (!preserveStoreData) {
    overlayStore.overlays = {};

    if (overlayStore.idSelectedOverlay) {
      overlayStore.idSelectedOverlay = null;
    }
  }
}

/**
 * Tear down all Leaflet image layers and markers while keeping overlay store data intact.
 * Used when entering view mode: tile-based rendering takes over, but the in-progress edit
 * state (history, isModified) must survive so the user can switch back without losing work.
 */
export function clearOverlayLayersOnly(): void {
  const overlayStore = useOverlayStore();
  registry.clearAll(false);
  if (overlayStore.idSelectedOverlay) {
    overlayStore.idSelectedOverlay = null;
  }
}

// Wipe overlays, view-mode cache, and standalone markers. Used to enter a focused single-submission preview.
export function clearAllMapContent(): void {
  clearAllOverlays();
  useOverlayStore().clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
}
