// MapLibre overlay rendering: creates image sources/raster layers. Status markers are owned by the
// viewport reconciler (reconcileOverlayExistence), not created here.

import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { resolveOverlayCorners, enrichOverlayWithProject } from "@/services/overlay/data";
import { upsertOverlayFromWire } from "@/services/overlay/sync";
import * as registry from "@/services/overlay/mapLayers";
import { createOverlayImage } from "@/services/overlay/mapLayers";
import type { OverlayObject, OverlayData } from "@/types/index";

/**
 * Render backend CDN overlay images on the map. Markers are owned by the viewport reconciler; a
 * reconcile is scheduled afterwards so each freshly-created image gets its status pin.
 */
export function renderViewModeOverlays(viewModeOverlays: OverlayData[]): void {
  // renderSingleOverlay's beginCreation gate handles "already rendered" and "in flight".
  for (const cdnOverlay of viewModeOverlays) {
    renderSingleOverlay(cdnOverlay);
  }
  registry.scheduleOverlayReconcile();
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
  registry.recordAppliedCorners(overlayObject.id, corners);
  registry.endCreation(overlayObject.id);
}

/**
 * Render a single overlay as a MapLibre image source + raster layer.
 */
function renderSingleOverlay(cdnOverlay: OverlayData): void {
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

  // Ingest into the single canonical store object (created once, mutated in place afterwards),
  // then render that instance so its identity is stable across re-renders.
  const overlay = upsertOverlayFromWire(cdnOverlay);
  enrichOverlayWithProject(overlay);

  const corners = resolveOverlayCorners(overlay, "image");
  if (!corners) {
    registry.endCreation(cdnOverlay.id);
    return;
  }

  const handle = createOverlayImage(overlay, corners);
  if (!handle) {
    registry.endCreation(cdnOverlay.id);
    return;
  }
  registry.setImageHandle(cdnOverlay.id, handle);
  registry.recordAppliedCorners(cdnOverlay.id, corners);

  registry.endCreation(cdnOverlay.id);
}
