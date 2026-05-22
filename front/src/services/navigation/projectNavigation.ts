import L from "leaflet";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { map } from "@/services/core/map";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { requestScrollTo } from "@/services/layout/accordionState";

/** Zoom to an overlay and optionally select it once rendered. */
export function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
  autoSelect = true,
): boolean {
  if (corners.length !== 4) return false;

  const bounds = L.latLngBounds(corners.map((c) => L.latLng(c.lat, c.lng)));
  const flightSkipped = mobileAwareFlyToBounds(bounds);

  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Poll per animation frame until the overlay element exists and its image is loaded.
  function waitForElementThenSelect(): void {
    const currentLayer = registry.getLayer(overlayId);
    const element = currentLayer?.getElement();

    if (!element) {
      requestAnimationFrame(waitForElementThenSelect);
      return;
    }

    if (!autoSelect) return;

    if (element.complete && element.naturalWidth > 0) {
      selectOverlay(overlayId);
    } else {
      element.addEventListener(
        "load",
        () => {
          selectOverlay(overlayId);
        },
        { once: true },
      );
    }
  }

  // If flight was skipped (camera already at target), select immediately since
  // moveend will never fire.
  if (flightSkipped) {
    waitForElementThenSelect();
    return true;
  }

  map.value.once("moveend", () => {
    // After zoom, check if the overlay layer needs to be re-rendered.
    const overlayObj = overlayStore.overlays[overlayId];
    const overlayLayer = registry.getLayer(overlayId);
    if (overlayObj && !overlayLayer) {
      // Layer was cleared (zoom-out pruning) but overlay data is still in the store.
      // Re-render it and select it via onReady callback once the image is fully loaded.
      // This avoids the polling loop that could spin forever if the layer never appears.
      // If another render is already in flight (beginCreation returns false inside
      // renderViewModeOverlays), fall back to the polling loop which will find the layer
      // once that in-flight render completes.
      void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
        if (registry.hasReadyLayer(overlayId)) {
          // Layer appeared between moveend and the import resolving.
          if (autoSelect) selectOverlay(overlayId);
          return;
        }
        // Pass createMarkers=true so the marker is recreated if it was wiped by
        // clearAll(preserveMarkers=false) when zooming out.
        // createSingleMarker has a duplicate guard so this is safe.
        const ourRenderStarted = renderViewModeOverlays(
          [overlayObj],
          true,
          autoSelect
            ? () => {
                selectOverlay(overlayId);
              }
            : undefined,
        );
        if (ourRenderStarted) {
          // Our render is in flight with onReady wired, do not poll.
          // waitForElementThenSelect would race: it calls selectOverlay before
          // overlayStore.addOverlay runs (deferred via scheduleInitialization rAF queue),
          // which makes the "already selected" guard in onReady's selectOverlay fire early.
          return;
        }
        if (registry.hasReadyLayer(overlayId)) {
          // Layer became ready between our render call and here (very fast completion)
          if (autoSelect) selectOverlay(overlayId);
          return;
        }
        if (registry.isCreating(overlayId)) {
          // A concurrent render is in flight without our onReady, poll until it lands.
          waitForElementThenSelect();
          return;
        }
        // renderViewModeOverlays was a no-op (e.g. zoom < MIN_ZOOM_FOR_OVERLAYS).
        // Nothing we can do, the overlay can't be shown at this zoom level.
      });
      // Do not call waitForElementThenSelect here; the onReady callback handles selection.
      return;
    } else if (overlayLayer && !map.value.hasLayer(overlayLayer)) {
      const currentZoom = map.value.getZoom();
      if (currentZoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS)) {
        const authStore = useAuthStore();
        if (overlayObj && isOverlayVisible(overlayObj, mapStore.mode, authStore.user?.id)) {
          overlayLayer.addTo(map.value);
          // If this overlay is selected, bring it to front; otherwise keep the currently selected overlay on top.
          requestAnimationFrame(() => {
            if (overlayStore.idSelectedOverlay === overlayId) {
              overlayLayer.bringToFront();
            } else if (overlayStore.idSelectedOverlay) {
              const selectedLayer = registry.getLayer(overlayStore.idSelectedOverlay);
              if (selectedLayer) {
                selectedLayer.bringToFront();
              }
            }
          });
        }
      }
    }

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
        void handleProjectClickFromTile(projectId, L.latLng(lat, lng));
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
