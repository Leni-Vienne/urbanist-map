import { LngLat, LngLatBounds } from "maplibre-gl";
import { selectOverlay } from "@/services/overlay/selection";
import { map } from "@/services/core/map";
import * as registry from "@/services/overlay/renderRegistry";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
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

  // Poll per animation frame until the overlay element exists and its image is loaded.
  let attempts = 0;
  function waitForElementThenSelect(): void {
    if (!registry.hasReadyLayer(overlayId)) {
      attempts++;
      // Stop polling after ~5 seconds (60fps * 5 = 300 attempts) to avoid infinite loops
      if (attempts > 300) {
        console.warn("Overlay did not render in time, aborting auto-select", overlayId);
        return;
      }
      requestAnimationFrame(waitForElementThenSelect);
      return;
    }

    if (!autoSelect) return;

    selectOverlay(overlayId);
  }

  // If flight was skipped (camera already at target), select immediately since
  // moveend will never fire.
  if (flightSkipped) {
    waitForElementThenSelect();
    return true;
  }

  map.value.once("moveend", () => {
    waitForElementThenSelect();
  });

  return true;
}

/**
 * Navigate to a standalone project marker by project ID.
 */
export async function navigateToStandaloneProject(
  lat: number,
  lng: number,
  projectId?: string,
): Promise<void> {
  try {
    await new Promise<void>(
      (resolve) =>
        void setTimeout(() => {
          resolve();
        }, 200),
    );

    // Scroll the side panel to this project before the flight completes.
    if (projectId) {
      requestScrollTo("project", projectId);
    }

    const flew = mobileAwareFlyTo([lat, lng], 18);

    if (projectId) {
      const id = projectId;
      function openPopup(): void {
        void handleProjectClickFromTile(id, new LngLat(lng, lat));
      }
      // moveend never fires when the flight is skipped, so open the popup directly in that case.
      if (flew) {
        map.value.once("moveend", openPopup);
      } else {
        openPopup();
      }
    }
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}
