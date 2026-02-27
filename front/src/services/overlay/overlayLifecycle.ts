// AI : Overlay lifecycle management - extracted to break circular dependencies
// AI : Also serves as the shared state hub for cross-chunk callback registration,
// AI : keeping these tiny primitives out of the lazy chunks (overlayRendering, overlayToolbar).
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import * as registry from "@/services/overlay/overlayRenderRegistry";

// AI : Cross-chunk callback registry. Modules in the initial bundle assign these at init time;
// AI : lazy chunks (overlayRendering, overlayToolbar) read them at call time.
// AI : Using a plain object so importers can mutate properties directly without ES module re-export restrictions.
export const overlayCallbacks: {
  // AI : Registered by overlayEditing.ts (initial bundle); called from overlayToolbar.ts (lazy chunk)
  focusCameraToOverlay: ((direction: "next" | "previous") => void) | null;
  undo: (() => void) | null;
  redo: (() => void) | null;
} = {
  focusCameraToOverlay: null,
  undo: null,
  redo: null,
};

/**
 * AI : Clear all overlays from the map and reset collections.
 * AI : Delegates Leaflet layer/marker cleanup to overlayRenderRegistry.
 * AI : NOTE: Does NOT clear viewModeOverlays — managed by viewport loading.
 * @param preserveStoreData - If true, only removes Leaflet image layers but keeps marker refs
 *                            and overlay data in store. Used for zoom threshold crossings.
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  // AI : registry.clearAll handles all Leaflet cleanup — no need to iterate map.eachLayer()
  // AI : because the registry is the canonical source of all live layers (created via beginCreation).
  registry.clearAll(preserveStoreData);

  if (!preserveStoreData) {
    overlayStore.overlays = {};

    if (overlayStore.idSelectedOverlay) {
      overlayStore.idSelectedOverlay = null;
    }
  }
  // AI : When preserveStoreData=true, overlay data and marker refs remain intact —
  // AI : markers stay on the Leaflet map so they can be shown at zoom 13 without
  // AI : being recreated when the user zooms back to 14.
}
