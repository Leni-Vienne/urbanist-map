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
    // Carry over an unsaved local image (e.g. a crop's data URL) so the re-rendered overlay keeps
    // the edited pixels instead of reverting to the backend image the fresh object was built from.
    if (existingOverlay.imageUrl.startsWith("data:")) {
      overlayObject.imageUrl = existingOverlay.imageUrl;
      overlayObject.filename = existingOverlay.filename;
    }
  }

  const enriched = enrichOverlayWithProject(overlayObject);

  const corners = resolveOverlayRenderCorners(enriched);
  if (!corners) {
    registry.cancelCreation(cdnOverlay.id);
    return;
  }

  const handle = createOverlayImage(enriched, corners);
  if (!handle) {
    registry.cancelCreation(cdnOverlay.id);
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
  const overlay = overlayStore.overlays[cdnOverlay.id];

  // View mode passes createMarkers=false and relies on the overlay-footprints MVT layer
  // for low-zoom representation and click handling.
  if (createMarkers && overlay) {
    createOverlayMarker(overlay);
    updateMarkerTooltip(overlay);
  }

  // A standalone project marker may have been shown for this project while its overlays
  // were pending/invisible. Remove it now that a real overlay is on the map.
  if (cdnOverlay.projectId) {
    removeStandaloneProjectMarkerForProject(cdnOverlay.projectId);
  }

  registry.cancelCreation(cdnOverlay.id);
}
