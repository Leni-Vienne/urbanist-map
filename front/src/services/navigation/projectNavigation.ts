import { LngLat, LngLatBounds } from "maplibre-gl";
import { selectOverlay } from "@/services/overlay/selection";
import { map } from "@/services/core/map";
import * as registry from "@/services/overlay/renderRegistry";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { requestScrollTo } from "@/services/layout/accordionState";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

/** Zoom to an overlay and optionally select it once rendered. */
export function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
  autoSelect = true,
): boolean {
  if (corners.length !== 4) return false;

  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }

  const llb: [[number, number], [number, number]] = [
    [bounds.getWest(), bounds.getSouth()],
    [bounds.getEast(), bounds.getNorth()],
  ];

  let targetZoom = 18;
  try {
    // Calculate ~10% of the screen's shortest dimension for padding, defaulting to at least 80px
    const dynamicPadding =
      typeof window !== "undefined"
        ? Math.max(80, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.1))
        : 80;

    const cam = map.value.cameraForBounds(llb, { padding: dynamicPadding, maxZoom: 18 });
    if (cam && typeof cam.zoom === "number") {
      targetZoom = cam.zoom;
    }
  } catch {
    // ignore
  }

  // Ensure zoom is high enough to show overlays
  const minRequiredZoom = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  targetZoom = Math.max(targetZoom, minRequiredZoom);

  const center = bounds.getCenter();
  const flightSkipped = !mobileAwareFlyTo(center, targetZoom);

  // Select once the overlay's image layer comes online (created asynchronously after the camera
  // settles). Give up after ~5s for overlays that never render.
  function selectWhenReady(): void {
    function select(): void {
      if (autoSelect) selectOverlay(overlayId);
    }
    function onReadyTimeout(): void {
      console.warn("Overlay did not render in time, aborting auto-select", overlayId);
    }
    registry.whenImageReady(overlayId, select, { timeoutMs: 5000, onTimeout: onReadyTimeout });
  }

  // If flight was skipped (camera already at target), wait immediately since moveend never fires.
  if (flightSkipped) {
    selectWhenReady();
    return true;
  }

  void map.value.once("moveend", selectWhenReady);

  return true;
}

// Open the project detail once the camera settles. moveend never fires when the flight was skipped
// (camera already at target), so open directly in that case to avoid hanging.
function openDetailAfterFlight(flew: boolean, projectId: string): void {
  function openDetail(): void {
    void handleProjectClickFromTile(projectId);
  }
  if (flew) {
    void map.value.once("moveend", openDetail);
  } else {
    openDetail();
  }
}

/**
 * Navigate to a standalone project marker by project ID. Flies to the point, then opens the popup.
 */
export function navigateToStandaloneProject(lat: number, lng: number, projectId?: string): void {
  try {
    // Scroll the side panel to this project before the flight completes.
    if (projectId) {
      requestScrollTo("project", projectId);
    }

    // Drawer-aware padding centers the feature in the map area above the mobile drawer (desktop
    // centers it in the full viewport).
    const flew = mobileAwareFlyTo([lat, lng], 18);

    if (projectId) {
      openDetailAfterFlight(flew, projectId);
    }
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}

/**
 * Navigate to a standalone project by fitting its geometry bounds, then selecting it. Use when the
 * project has real geometry bounds rather than a single marker point.
 */
export function navigateToStandaloneProjectBounds(bounds: LngLatBounds, projectId: string): void {
  try {
    requestScrollTo("project", projectId);
    const flew = mobileAwareFlyToBounds(bounds, { maxZoom: 18 });
    openDetailAfterFlight(flew, projectId);
  } catch (error) {
    console.error("Failed to navigate to marker project bounds:", error);
    throw error;
  }
}
