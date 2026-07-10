import { useOverlayStore } from "@/stores/overlayStore";
import * as registry from "@/services/overlay/mapLayers";
import { selectOverlay } from "@/services/overlay/selection";

/**
 * Remove only the overlay image layers, keeping the markers on the map and the overlay store
 * data intact. Used at zoom-threshold crossings so markers don't flicker.
 */
export function clearOverlayImagesOnly(): void {
  registry.clearAll(true);
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

/**
 * Full wipe: deselect, tear down all image layers and markers, and drop the overlay store data.
 */
export function clearAllOverlays(): void {
  selectOverlay(null);
  registry.clearAll(false);
  useOverlayStore().liveOverlays = {};
}

// Wipe overlays and the render-loop list. Used to enter a focused single-submission preview.
export function clearAllMapContent(): void {
  clearAllOverlays();
  useOverlayStore().clearRenderLoopOverlays();
}
