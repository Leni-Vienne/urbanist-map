import { useOverlayStore } from "@/stores/overlayStore";
import * as registry from "@/services/overlay/mapLayers";
import { closeDetail } from "@/services/overlay/selection";
import { clearMapSessionSnapshot } from "@/services/map/mapSessionState";

/**
 * Remove only the overlay image layers, keeping the markers on the map and the overlay store
 * data intact. Used entering edit mode, where the images are re-created at their edit-session
 * position rather than the view-mode baseline footprint.
 */
export function clearOverlayImagesOnly(): void {
  registry.clearAll(true);
}

/**
 * Remove every overlay map object (images, markers, gesture ownership, image-ready
 * waiters) while leaving the overlay store data and the current selection untouched. Used on map
 * teardown, where the render objects die with the MapLibre instance but the application state
 * (history, staged modifications, open detail) must survive.
 */
export function clearOverlayRenderObjects(): void {
  registry.clearMapObjectRegistry();
}

/**
 * Close the overlay detail and tear down all image layers and markers, keeping overlay store data
 * intact. Used when entering view mode: tile-based rendering takes over, but the in-progress edit
 * state (history, staged pending modifications) must survive so the user can switch back
 * without losing work.
 */
export function clearOverlayRenderState(): void {
  closeDetail();
  registry.clearAll(false);
}

/**
 * Full wipe: deselect, tear down all image layers and markers, and drop the overlay store data.
 */
export function clearAllOverlays(): void {
  closeDetail();
  registry.clearAll(false);
  useOverlayStore().clearLiveOverlays();
}

// Wipe overlays and the active map session. Used to enter a focused single-submission preview.
export function clearAllMapContent(): void {
  clearAllOverlays();
  clearMapSessionSnapshot();
}
