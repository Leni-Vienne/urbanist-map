import { LngLat, LngLatBounds } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { map } from "@/services/core/map";
import {
  getOverlayMarkerColor,
  createOverlayMarkerElement,
  updateMarkerTooltip,
} from "@/services/map/markers";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { getOverlayImageCorners } from "@/services/overlay/overlayImageLayer";
import {
  selectOverlay,
  highlightProject,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";

/**
 * Create a single marker for an overlay (for view mode overlays)
 */
export function createSingleMarker(savedOverlay: OverlayObject): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const mlMap = map.value;
  if (!mlMap) return;

  // Skip replaced overlays - the replacement is at the same location, marker would be confusing
  if (savedOverlay.status === "replaced") {
    return;
  }

  if (registry.getMarker(savedOverlay.id)) {
    return;
  }

  // Visibility check: filters out overlays that don't pass mode/user conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(savedOverlay, mapStore.mode, authStore.user?.id)) {
    return;
  }

  // Use the user's last edited position in edit mode to prevent marker flicker when zooming.
  // history.at(-1) survives layer pruning since it lives on the OverlayObject in the store.
  let corners = savedOverlay.corners;
  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.overlays[savedOverlay.id]?.history.at(-1);
    if (lastEdited?.length === 4) {
      corners = lastEdited;
    }
  }

  if (corners.length !== 4) {
    return;
  }

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) {
    return;
  }

  // Enrich overlay with project data for proper marker color calculation
  const tempOverlayObject = enrichOverlayWithProject(savedOverlay);
  const markerColor = getOverlayMarkerColor(tempOverlayObject, mapStore.mode);
  const element = createOverlayMarkerElement(markerColor);

  const marker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([centroid.lng, centroid.lat])
    .addTo(mlMap);

  element.addEventListener("click", (e) => {
    e.stopPropagation();

    const overlayObject = overlayStore.overlays[savedOverlay.id];
    if (!overlayObject) return;

    // Selection drives the toolbar and edit handles, so it must run before the camera fly
    // below, which can bail (or previously threw) on degenerate bounds.
    if (overlayStore.idSelectedOverlay === savedOverlay.id) {
      selectOverlay(null);
      return;
    }

    // Default to viewing the approved position on first click
    if (overlayObject.isViewingApprovedPosition === undefined) {
      overlayObject.isViewingApprovedPosition = true;
    }
    syncPreviewStateOnNavigation(savedOverlay.id, overlayObject.isViewingApprovedPosition ?? true);

    selectOverlay(savedOverlay.id);

    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds);
    }
  });

  // Capture projectId to avoid non-null assertion inside hover callbacks
  const projectId = savedOverlay.projectId;
  if (projectId) {
    element.addEventListener("mouseenter", () => {
      highlightProject(projectId);
    });
    element.addEventListener("mouseleave", () => {
      removeProjectOutlines(projectId);
    });
  }

  registry.setMarker(savedOverlay.id, marker);
  updateMarkerTooltip(tempOverlayObject, markerColor);
}

/**
 * Create a marker for new/replacement overlays (for edit mode)
 */
export function createMarker(overlayObject: OverlayObject): void {
  const mapStore = useMapStore();
  const mlMap = map.value;
  if (!mlMap) return;

  // Visibility check: filters out overlays that don't pass mode/user conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(overlayObject, mapStore.mode, authStore.user?.id)) {
    return;
  }

  const markerColor = getOverlayMarkerColor(overlayObject, "edit");
  const element = createOverlayMarkerElement(markerColor);

  const marker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat(mlMap.getCenter())
    .addTo(mlMap);

  element.addEventListener("click", (e) => {
    // Marker DOM clicks bubble to the map container and would fire MapLibre's map "click",
    // re-running the background hit-test on the same click. Stop it here.
    e.stopPropagation();
    selectOverlay(overlayObject.id);
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds);
    }
  });

  registry.setMarker(overlayObject.id, marker);
  updateMarkerTooltip(overlayObject);
}

function buildBounds(corners: { lat: number; lng: number }[]): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }
  return bounds;
}

/**
 * Get bounds for an overlay (for camera navigation)
 */
export function getOverlayBounds(overlay: OverlayData): LngLatBounds | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Priority 0: live image position (most accurate when the overlay is rendered)
  const liveCorners = getOverlayImageCorners(overlay.id);
  if (liveCorners?.length === 4) {
    return buildBounds(liveCorners);
  }

  // Priority 1: In edit mode use the user's last edited position from history
  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.overlays[overlay.id]?.history.at(-1);
    if (lastEdited?.length === 4) {
      return buildBounds(lastEdited);
    }
  }

  // Priority 2: Use overlay corners from overlayData
  if (overlay.corners.length === 4) {
    return buildBounds(overlay.corners);
  }

  return null;
}

// oxlint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
