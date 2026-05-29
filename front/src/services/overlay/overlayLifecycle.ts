import { useOverlayStore } from "@/stores/pinia/overlayStore";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";

/**
 * Clear all overlays from the map and reset collections.
 * Delegates layer/marker cleanup to overlayRenderRegistry.
 * Does not clear viewModeOverlays, which is managed by viewport loading.
 * @param preserveStoreData - If true, only removes image layers but keeps marker refs
 *                            and overlay data in store. Used for zoom threshold crossings.
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  // registry.clearAll is the canonical source of all live layers (created via beginCreation).
  registry.clearAll(preserveStoreData);

  if (!preserveStoreData) {
    overlayStore.overlays = {};

    if (overlayStore.idSelectedOverlay) {
      overlayStore.idSelectedOverlay = null;
    }
  }
}

/**
 * Tear down all image layers and markers while keeping overlay store data intact.
 * Used when entering view mode: tile-based rendering takes over, but the in-progress edit
 * state (history, isModified) must survive so the user can switch back without losing work.
 */
export function clearOverlayRenderState(): void {
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
