import L from "leaflet";
import { loadCityProjects } from "@/composables/map/useCityMarkers";
import { navigateToOverlay } from "@/composables/overlay/useOverlay";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { prepareCountryContext } from "@/composables/map/useCountryMarkers";
import { prepareCrossCountryFlight } from "@/composables/map/useTileLayers";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerOpacities,
} from "@/composables/map/useStandaloneProjectMarkers";
import { createProjectInfoTeleportTarget } from "@/composables/map/useProjectPopupTeleport";
import type { OverlayObject } from "@/types/index";

/**
 * AI : Get the corners that should be used for navigation based on current display state
 * AI : Respects whether user is viewing suggested position or approved position
 * @param overlay - The overlay object
 * @returns Corners to navigate to (suggested or approved)
 */
function getCurrentDisplayCorners(overlay: OverlayObject): { lat: number; lng: number }[] | null {
  // AI : If overlay has Leaflet instance, get actual rendered corners (most accurate)
  if (overlay.overlay) {
    const actualCorners = overlay.overlay.getCorners();
    if (actualCorners?.length === 4) {
      return actualCorners.map((c) => ({ lat: c.lat, lng: c.lng }));
    }
  }

  // AI : If user is viewing suggested position, use suggestedCorners
  if (overlay.isViewingApprovedPosition === false && overlay.suggestedCorners?.length === 4) {
    return overlay.suggestedCorners;
  }

  // AI : Default: use approved corners
  if (overlay.corners?.length === 4) {
    return overlay.corners;
  }

  return null;
}

/**
 * AI : Shared logic for navigating to a location by simulating country → city marker clicks
 * AI : This loads the country cities, adds city markers, and load city projects
 * @returns Callback to switch to country layer after flight, or null if not cross-country
 */
async function prepareNavigationToCity(
  cityId: string,
  cityName: string,
  countryCode?: string,
): Promise<(() => void) | null> {
  let switchToCountryLayer: (() => void) | null = null;

  if (countryCode) {
    // AI : Step 1: Prepare for cross-country flight (switches to esri if needed)
    switchToCountryLayer = prepareCrossCountryFlight(countryCode);

    // AI : Step 2: Prepare country context (clear map, load cities, add markers)
    await prepareCountryContext(countryCode);
  }

  // AI : Step 3: Simulate city marker click (this loads and renders all markers and overlays for the city)
  await loadCityProjects(cityId, cityName, false, countryCode);

  return switchToCountryLayer;
}

/**
 * AI : Zoom to overlay and select it once rendered
 */
function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
  switchToCountryLayer: (() => void) | null,
): boolean {
  if (!map.value || corners.length !== 4) return false;

  const bounds = L.latLngBounds(corners.map((c) => L.latLng(c.lat, c.lng)));
  mobileAwareFlyToBounds(bounds, {
    padding: [50, 50] as [number, number],
    duration: 1.5,
    easeLinearity: 0.25,
  });

  const overlayStore = useOverlayStore();

  map.value.once("moveend", () => {
    // AI : If cross-country flight, switch to country layer after arrival
    if (switchToCountryLayer) {
      switchToCountryLayer();
    }

    // AI : Wait for element to exist, then wait for image to load before selecting
    // AI : This fixes the bug where first click adds blue outline but doesn't open toolbar
    // AI : getElement() returns null until the DOM element is created (takes a few frames)
    function waitForElementThenSelect(): void {
      const overlayObj = overlayStore.overlays[overlayId];
      const element = overlayObj?.overlay?.getElement();

      if (!element) {
        requestAnimationFrame(waitForElementThenSelect);
        return;
      }

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

    waitForElementThenSelect();
  });

  return true;
}

/**
 * AI : Get corners from either loaded overlay or mapStore data
 */
function getOverlayCorners(
  overlayId: string,
  mapStore: ReturnType<typeof useMapStore>,
  overlayStore: ReturnType<typeof useOverlayStore>,
): { lat: number; lng: number }[] | null {
  // AI : Try loaded overlay first (respects current display position)
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject != null) {
    return getCurrentDisplayCorners(overlayObject);
  }

  // AI : Fallback to mapStore data
  const overlayData = mapStore.currentCityOverlays.find((o) => o.id === overlayId);
  return overlayData?.corners ?? null;
}

/**
 * AI : Handle navigation when clicking the same overlay again
 */
function handleSameOverlayNavigation(
  overlayId: string,
  overlayStore: ReturnType<typeof useOverlayStore>,
): boolean {
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject != null) {
    const corners = getCurrentDisplayCorners(overlayObject);
    if (corners != null) {
      zoomToOverlayAndSelect(overlayId, corners, null); // AI : Same overlay, no cross-country
    }
  }
  return true;
}

/**
 * AI : Navigates to an overlay by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker → overlay
 * @param overlayId - The ID of the overlay to navigate to
 * @param cityId - The city ID where the overlay is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlayWithCity(
  overlayId: string,
  cityId: string,
  cityName: string,
  countryCode?: string,
): Promise<boolean> {
  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();

    // AI : Optimization 1: Check if clicking the same overlay again
    if (overlayStore.idSelectedOverlay === overlayId) {
      return handleSameOverlayNavigation(overlayId, overlayStore);
    }

    // AI : Optimization 2: Check if overlay is from the currently selected city
    const currentCity = mapStore.selectedCity;
    const isSameCity = currentCity?.id === cityId;

    if (isSameCity) {
      const corners = getOverlayCorners(overlayId, mapStore, overlayStore);
      if (corners != null) {
        return zoomToOverlayAndSelect(overlayId, corners, null); // AI : Same city, no cross-country
      }
      // AI : If null, fall through to different city path
    }

    // AI : Different city - load everything with cross-country flight support
    const switchToCountryLayer = await prepareNavigationToCity(cityId, cityName, countryCode);

    if (!map.value) {
      return false;
    }

    const overlayData = mapStore.currentCityOverlays.find((o) => o.id === overlayId);
    if (overlayData?.corners != null) {
      return zoomToOverlayAndSelect(overlayId, overlayData.corners, switchToCountryLayer);
    }

    // AI : Fallback: if overlay not in current city overlays, use the old method
    return navigateToOverlay(overlayId, true, false);
  } catch (error) {
    console.error("Failed to navigate to overlay with city:", error);
    throw error;
  }
}

/**
 * AI : Navigates to a marker project by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker
 * @param lat - Latitude of the marker project
 * @param lng - Longitude of the marker project
 * @param cityId - The city ID where the marker project is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 * @param projectId - Optional project ID to open the info popup after navigation
 */
export async function navigateToStandaloneProject(
  lat: number,
  lng: number,
  cityId: string,
  cityName: string,
  countryCode?: string,
  projectId?: string,
): Promise<void> {
  try {
    // AI : Prepare navigation with cross-country flight support
    const switchToCountryLayer = await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : Wait a bit for markers to be added to the map
    await new Promise((resolve) => setTimeout(resolve, 200));

    // AI : Fly to marker project coordinates
    if (!map.value) {
      throw new Error("Map is not initialized");
    }

    mobileAwareFlyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // AI : Handle post-flight actions
    map.value.once("moveend", () => {
      // AI : If cross-country flight, switch to country layer after arrival
      if (switchToCountryLayer) {
        switchToCountryLayer();
      }

      // AI : If projectId provided, open the project info popup
      if (projectId) {
        const overlayStore = useOverlayStore();
        const uiStore = useUiStore();

        // AI : Get the marker from the map using projectId (more efficient than searching)
        const marker = getStandaloneProjectMarkerByProjectId(projectId);
        if (!marker) return;

        // AI : Create teleport target at marker position
        createProjectInfoTeleportTarget(marker);

        // AI : Update marker opacities (make this one fully opaque)
        updateStandaloneProjectMarkerOpacities(marker);

        // AI : Close overlay popup if it's open (only one popup at a time)
        if (overlayStore.showInfoPopup) {
          overlayStore.hideInfoPopup();
        }

        // AI : Open project info popup using uiStore (same as click handler)
        // AI : Project data is loaded from backend by InfoPopupContainer if needed
        uiStore.openProjectInfoPopup(projectId);
      }
    });
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}
