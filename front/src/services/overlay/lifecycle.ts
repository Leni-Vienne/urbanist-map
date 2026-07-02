import { useOverlayStore } from "@/stores/overlayStore";
import * as registry from "@/services/overlay/mapLayers";
import { selectOverlay } from "@/services/overlay/selection";

/**
 * Clear all overlays from the map and reset collections.
 * Delegates layer/marker cleanup to overlayRenderRegistry.
 * Does not clear viewModeOverlays, which is managed by viewport loading.
 * @param preserveStoreData - If true, only removes image layers but keeps marker refs
 *                            and overlay data in store. Used for zoom threshold crossings.
 */
export function clearAllOverlays(preserveStoreData = false): void {
  const overlayStore = useOverlayStore();

  // Deselect before tearing layers and store down: selectOverlay(null) owns the full
  // cleanup (edit handles, project highlight, docked detail) and needs live state.
  if (!preserveStoreData) {
    selectOverlay(null);
  }

  // registry.clearAll is the canonical source of all live layers (created via beginCreation).
  registry.clearAll(preserveStoreData);

  if (!preserveStoreData) {
    overlayStore.liveOverlays = {};
  }
}

/**
 * Tear down all image layers and markers while keeping overlay store data intact.
 * Used when entering view mode: tile-based rendering takes over, but the in-progress edit
 * state (history, staged pending modifications) must survive so the user can switch back
 * without losing work.
 */
export function clearOverlayRenderState(): void {
  selectOverlay(null);
  registry.clearAll(false);
}

// Wipe overlays and view-mode cache. Used to enter a focused single-submission preview.
export function clearAllMapContent(): void {
  clearAllOverlays();
  useOverlayStore().clearViewModeOverlays();
}
