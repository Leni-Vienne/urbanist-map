// MapLibre overlay rendering: creates image sources/raster layers and status markers.

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { createOverlayObject } from "@/utils/typeFactories";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { resolveOverlayRenderCorners } from "@/services/overlay/overlayHistory";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
import { updateMarkerTooltip } from "@/services/map/markers";
import { createOverlayMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { createOverlayImage } from "@/services/overlay/overlayImageLayer";
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

  const corners = resolveOverlayRenderCorners(overlayObject);
  if (!corners) {
    registry.cancelCreation(overlayObject.id);
    return;
  }

  const handle = createOverlayImage(overlayObject, corners);
  if (!handle) {
    registry.cancelCreation(overlayObject.id);
    return;
  }
  registry.setImageHandle(overlayObject.id, handle);
  registry.cancelCreation(overlayObject.id);
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

  const existingOverlay = overlayStore.overlays[cdnOverlay.id];
  const overlayObject = createOverlayObject(cdnOverlay);

  // Preserve in-progress edit state when re-rendering. history.at(-1) is the user's last
  // edited position; without this carryover the image would snap back to backend corners
  // on any round-trip (e.g. edit -> view -> edit) since the fresh object has empty history.
  if (existingOverlay) {
    overlayObject.isViewingApprovedPosition = existingOverlay.isViewingApprovedPosition;
    overlayObject.history = [...existingOverlay.history];
    overlayObject.redoStack = [...existingOverlay.redoStack];
    overlayObject.isModified = existingOverlay.isModified;
  }

  const overlayObjectWithMethods = enrichOverlayWithProject(overlayObject);

  const corners = resolveOverlayRenderCorners(overlayObjectWithMethods);
  if (!corners) {
    registry.cancelCreation(cdnOverlay.id);
    return;
  }

  const handle = createOverlayImage(overlayObjectWithMethods, corners);
  if (!handle) {
    registry.cancelCreation(cdnOverlay.id);
    return;
  }
  registry.setImageHandle(cdnOverlay.id, handle);

  overlayStore.addOverlay(cdnOverlay.id, overlayObjectWithMethods);

  // View mode passes createMarkers=false and relies on the overlay-footprints MVT layer
  // for low-zoom representation and click handling.
  if (createMarkers) {
    createOverlayMarker(overlayObjectWithMethods);
    updateMarkerTooltip(overlayObjectWithMethods);
  }

  // A standalone project marker may have been shown for this project while its overlays
  // were pending/invisible. Remove it now that a real overlay is on the map.
  if (cdnOverlay.projectId) {
    removeStandaloneProjectMarkerForProject(cdnOverlay.projectId);
  }

  registry.cancelCreation(cdnOverlay.id);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
