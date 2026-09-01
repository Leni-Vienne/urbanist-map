import * as registry from "@/services/overlay/mapLayers";
import { closeDetail } from "@/services/overlay/selection";
import { clearMapSessionSnapshot } from "@/services/map/mapSessionState";

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
  registry.clearAll();
}

export function clearMapProjectionState(): void {
  clearOverlayRenderState();
  clearMapSessionSnapshot();
}
