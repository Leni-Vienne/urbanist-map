// MapLibre overlay rendering: creates image sources/raster layers and status markers.

import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { createOverlayObject } from "@/utils/typeFactories";
import {
  resolveOverlayCorners,
  enrichOverlayWithProject,
  mergeEditState,
} from "@/services/overlay/data";
import { createOverlayMarker } from "@/services/overlay/markers";
import * as registry from "@/services/overlay/mapLayers";
import { createOverlayImage } from "@/services/overlay/mapLayers";
import type { OverlayObject, OverlayData } from "@/types/index";

/**
 * Render backend CDN overlays on the map for view mode.
 */
export function renderViewModeOverlays(
  viewModeOverlays: OverlayData[],
  createMarkers = true,
): void {
  // renderSingleOverlay's beginCreation gate handles "already rendered" and "in flight".
  for (const cdnOverlay of viewModeOverlays) {
    renderSingleOverlay(cdnOverlay, createMarkers);
  }
}

/**
 * Create the image source for an existing local OverlayObject (status === null).
 * Used by the viewport loop's local-overlay pipeline; the status marker is created separately.
 */
export function createOverlayImageForObject(overlayObject: OverlayObject): void {
  if (!registry.beginCreation(overlayObject.id)) return;

  const corners = resolveOverlayCorners(overlayObject, "image");
  if (!corners) {
    registry.endCreation(overlayObject.id);
    return;
  }

  const handle = createOverlayImage(overlayObject, corners);
  if (!handle) {
    registry.endCreation(overlayObject.id);
    return;
  }
  registry.setImageHandle(overlayObject.id, handle);
  registry.endCreation(overlayObject.id);
}

/**
 * Render a single overlay as a MapLibre image source + raster layer.
 */
function renderSingleOverlay(cdnOverlay: OverlayData, createMarkers = true): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Skip replaced overlays - their images are deleted and would cause 404 errors
  if (cdnOverlay.status === "replaced") {
    return;
  }

  const authStore = useAuthStore();
  if (!isOverlayVisible(cdnOverlay, mapStore.mode, authStore.user?.id)) {
    return;
  }

  // beginCreation atomically prevents a duplicate source for the same overlay.
  if (!registry.beginCreation(cdnOverlay.id)) {
    return;
  }

  const existingOverlay = overlayStore.liveOverlays[cdnOverlay.id];
  const overlayObject = createOverlayObject(cdnOverlay);

  // Preserve in-progress edit state when re-rendering, so the image doesn't snap back to backend
  // corners on any round-trip (e.g. edit -> view -> edit) where the fresh object has empty history.
  if (existingOverlay) {
    mergeEditState(overlayObject, existingOverlay);
  }

  const enriched = enrichOverlayWithProject(overlayObject);

  const corners = resolveOverlayCorners(enriched, "image");
  if (!corners) {
    registry.endCreation(cdnOverlay.id);
    return;
  }

  const handle = createOverlayImage(enriched, corners);
  if (!handle) {
    registry.endCreation(cdnOverlay.id);
    return;
  }
  registry.setImageHandle(cdnOverlay.id, handle);

  // One canonical object per id: refresh the stored instance in place so its identity is stable
  // across re-renders (any service holding the reference keeps seeing live state). Only the first
  // render creates the instance. The merge above already folded backend fields over edit state.
  if (existingOverlay) {
    overlayStore.updateOverlay(cdnOverlay.id, enriched);
  } else {
    overlayStore.addOverlay(cdnOverlay.id, enriched);
  }
  const overlay = overlayStore.liveOverlays[cdnOverlay.id];

  // View mode passes createMarkers=false and relies on the overlay-footprints MVT layer
  // for low-zoom representation and click handling.
  if (createMarkers && overlay) {
    createOverlayMarker(overlay);
  }

  registry.endCreation(cdnOverlay.id);
}
