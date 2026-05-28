// Leaflet overlay rendering and DOM manipulation
// Handles all Leaflet-specific overlay creation, loading, and event binding
import L from "leaflet";
// leaflet-toolbar must be imported before leaflet-distortableimage because
// the distortableimage IIFE uses L.Toolbar2.Action at module evaluation time (t[280]).
// In ESM, imports are evaluated in declaration order, so this ordering is critical
// to ensure L.Toolbar2 exists before the distortableimage bundle's IIFE runs.
import "leaflet-toolbar";
import "leaflet-distortableimage";
import { map } from "@/services/core/map";

// leaflet-distortableimage's addInitHook adds the 'ldi' class to the map container,
// which is required for the CSS rule that sets pointer-events: all on overlay images.
// Since this chunk loads lazily after map creation, the addInitHook never ran for the
// existing map, we must apply it manually here.
if (!L.DomUtil.hasClass(map.value.getContainer(), "ldi")) {
  L.DomUtil.addClass(map.value.getContainer(), "ldi");
}
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { createOverlayObject } from "@/utils/typeFactories";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { getCornersForOverlay } from "@/services/overlay/overlayHistory";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
import { updateMarkerTooltip, createSingleMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { createOverlayImage } from "@/services/overlay/overlayImageLayer";
import type { OverlayObject, OverlayData } from "@/types/index";

/**
 * Render backend CDN overlays on the map for view mode.
 * Returns true if at least one overlay render was actually started (beginCreation succeeded).
 * Returns false if all overlays were skipped (already rendering, already ready, zoom too low).
 * Callers that pass an onReady callback should only fall back to polling if this returns false.
 */
export function renderViewModeOverlays(
  viewModeOverlays: OverlayData[],
  createMarkers = true,
  onReady?: () => void,
): boolean {
  // renderSingleOverlay's beginCreation gate handles "already rendered" and "in flight".
  let anyStarted = false;
  for (const cdnOverlay of viewModeOverlays) {
    if (renderSingleOverlay(cdnOverlay, createMarkers, onReady)) {
      anyStarted = true;
    }
  }

  return anyStarted;
}

/**
 * Create the image source for an existing local OverlayObject (status === null).
 * Used by the viewport loop's local-overlay pipeline; the status marker is created separately.
 */
export function createOverlayImageForObject(overlayObject: OverlayObject): void {
  if (!registry.beginCreation(overlayObject.id)) return;

  const corners = getCornersForOverlay(overlayObject);
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
 * Returns true if creation was started (beginCreation succeeded), false otherwise.
 */
function renderSingleOverlay(
  cdnOverlay: OverlayData,
  createMarkers = true,
  onReady?: () => void,
): boolean {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Skip replaced overlays - their images are deleted and would cause 404 errors
  if (cdnOverlay.status === "replaced") {
    return false;
  }

  const authStore = useAuthStore();
  if (!isOverlayVisible(cdnOverlay, mapStore.mode, authStore.user?.id)) {
    return false;
  }

  // beginCreation atomically prevents a duplicate source for the same overlay.
  if (!registry.beginCreation(cdnOverlay.id)) {
    return false;
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

  const corners = getCornersForOverlay(overlayObjectWithMethods);
  if (!corners) {
    registry.cancelCreation(cdnOverlay.id);
    return false;
  }

  const handle = createOverlayImage(overlayObjectWithMethods, corners);
  if (!handle) {
    registry.cancelCreation(cdnOverlay.id);
    return false;
  }
  registry.setImageHandle(cdnOverlay.id, handle);

  overlayStore.addOverlay(cdnOverlay.id, overlayObjectWithMethods);

  // Markers are Leaflet-based (ported in a later phase step); view mode passes createMarkers=false
  // and relies on the overlay-footprints MVT layer for low-zoom representation and click handling.
  if (createMarkers) {
    createSingleMarker(overlayObjectWithMethods);
    updateMarkerTooltip(overlayObjectWithMethods);
  }

  // A standalone project marker may have been shown for this project while its overlays
  // were pending/invisible. Remove it now that a real overlay is on the map.
  if (cdnOverlay.projectId) {
    removeStandaloneProjectMarkerForProject(cdnOverlay.projectId);
  }

  registry.cancelCreation(cdnOverlay.id);
  onReady?.();
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
