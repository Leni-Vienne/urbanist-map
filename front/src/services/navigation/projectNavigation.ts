import { LngLat, LngLatBounds } from "maplibre-gl";
import { openOverlayDetail } from "@/services/overlay/selection";
import { getMap } from "@/services/core/map";
import * as registry from "@/services/overlay/mapLayers";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { handleProjectClickFromTile } from "@/services/core/projectSelection";
import { isValidQuad } from "@/services/overlay/transform";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

/** Zoom to an overlay and select it once rendered. */
export function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
): boolean {
  if (!isValidQuad(corners)) return false;

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
      typeof globalThis !== "undefined"
        ? Math.max(80, Math.floor(Math.min(globalThis.innerWidth, globalThis.innerHeight) * 0.1))
        : 80;

    const cam = getMap().cameraForBounds(llb, { padding: dynamicPadding, maxZoom: 18 });
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
      openOverlayDetail(overlayId);
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

  void getMap().once("moveend", selectWhenReady);

  return true;
}

/**
 * Navigate to a project by coordinates. Opens the detail and flies to the point concurrently;
 * the detail resolves the project by id and so does not depend on the camera or on rendered tiles.
 */
export function navigateToProject(lat: number, lng: number, projectId?: string): void {
  try {
    if (projectId) {
      void handleProjectClickFromTile(projectId);
    }
    // Drawer-aware padding centers the feature in the map area above the mobile drawer (desktop
    // centers it in the full viewport).
    mobileAwareFlyTo([lat, lng], 18);
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}

/**
 * Navigate to a project by fitting its geometry bounds, then selecting it. Use when the
 * project has real geometry bounds rather than a single marker point.
 */
export function navigateToProjectBounds(bounds: LngLatBounds, projectId: string): void {
  try {
    void handleProjectClickFromTile(projectId);
    mobileAwareFlyToBounds(bounds, { maxZoom: 18 });
  } catch (error) {
    console.error("Failed to navigate to marker project bounds:", error);
    throw error;
  }
}
