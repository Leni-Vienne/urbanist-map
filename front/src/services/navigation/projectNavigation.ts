import { LngLat, LngLatBounds } from "maplibre-gl";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { map } from "@/services/core/map";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { requestScrollTo } from "@/services/layout/accordionState";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";

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
  const flightSkipped = mobileAwareFlyToBounds(bounds);

  // Poll per animation frame until the overlay element exists and its image is loaded.
  function waitForElementThenSelect(): void {
    if (!registry.hasReadyLayer(overlayId)) {
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
    // Removed unused overlayObj

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

    mobileAwareFlyTo([lat, lng], 18);

    map.value.once("moveend", () => {
      if (projectId) {
        void handleProjectClickFromTile(projectId, new LngLat(lng, lat));
      }
    });
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
