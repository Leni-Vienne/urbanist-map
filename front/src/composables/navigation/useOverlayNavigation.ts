import L from "leaflet";
import { loadCityProjects } from "@/composables/map/useCityMarkers";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { loadCityDataForNavigation } from "@/composables/viewport/useViewportContentManager";
import { loadCitiesForCountry, clearAllMapContent } from "@/composables/map/useCountryData";
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
import { MAP_CONFIG } from "@/constants/mapConstants";
import { resolveOverlayCorners } from "@/composables/overlay/useOverlayPositionResolver";

/**
 * AI : Shared logic for navigating to a location by simulating country → city marker clicks
 * AI : This loads the country cities, adds city markers, and load city projects
 * @returns Callback to switch to country layer after flight, or null if not cross-country
 */
async function prepareNavigationToCity(
  cityId: number,
  cityName: string,
  countryCode?: string,
): Promise<(() => void) | null> {
  let switchToCountryLayer: (() => void) | null = null;

  if (countryCode) {
    const mapStore = useMapStore();
    // AI : Only clear when switching from one DEFINED country to a DIFFERENT country
    // AI : Don't clear when selectedCountryCode is undefined (global city markers loaded)
    const isDifferentCountry =
      mapStore.selectedCountryCode !== null && mapStore.selectedCountryCode !== countryCode;

    // AI : Step 1: Prepare for cross-country flight (switches to esri if needed)
    switchToCountryLayer = prepareCrossCountryFlight(countryCode);

    // AI : Step 2: Only clear map and reload cities when switching countries
    // AI : This prevents unnecessary removal of city markers when navigating within the same country
    if (isDifferentCountry) {
      clearAllMapContent();
      mapStore.selectedCountryCode = countryCode;
      await loadCitiesForCountry(countryCode);
    } else if (!mapStore.selectedCountryCode) {
      // AI : First time selecting a country - just set it without clearing
      mapStore.selectedCountryCode = countryCode;
      await loadCitiesForCountry(countryCode);
    }
  }

  // AI : Step 3: Simulate city marker click (this loads and renders all markers and overlays for the city)
  // AI : Use forceFullLoad=true to ensure overlays render even if current zoom is low
  // AI : This is necessary because we're about to fly to an overlay which requires the full overlay to exist
  await loadCityProjects(cityId, cityName, null, true, countryCode);

  return switchToCountryLayer;
}

/**
 * AI : Zoom to overlay and optionally select it once rendered
 * @param autoSelect - Whether to auto-select the overlay after zoom (default: true)
 */
function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
  switchToCountryLayer: (() => void) | null,
  autoSelect = true,
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

    // AI : CRITICAL: After zoom completes, check if overlay needs to be rendered
    // AI : This handles the case where overlays were loaded while zoomed out
    // AI : The overlay might exist in overlayStore but not be rendered on the map
    const overlayObj = overlayStore.overlays[overlayId];
    if (overlayObj && !overlayObj.overlay) {
      // AI : Overlay object exists but Leaflet overlay not created - this shouldn't happen
      // AI : but if it does, we need to trigger a re-render
      console.warn(`Overlay ${overlayId} exists in store but has no Leaflet overlay`);
    } else if (overlayObj?.overlay && map.value && !map.value.hasLayer(overlayObj.overlay)) {
      //  AI : Overlay exists but not on map - add it now that zoom is correct
      const currentZoom = map.value.getZoom();
      if (currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        overlayObj.overlay.addTo(map.value);
      }
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

      // AI : Only select if autoSelect is enabled
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

    waitForElementThenSelect();
  });

  return true;
}

/**
 * AI : Handle navigation when clicking the same overlay again
 * AI : Uses position resolver to get current corners
 */
function handleSameOverlayNavigation(overlayId: string): boolean {
  const corners = resolveOverlayCorners(overlayId);
  if (corners !== null) {
    zoomToOverlayAndSelect(overlayId, corners, null); // AI : Same overlay, no cross-country
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
  cityId: number,
  cityName: string,
  countryCode?: string,
  autoSelect = true,
): Promise<boolean> {
  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();

    // AI : Optimization 1: Check if clicking the same overlay again
    if (overlayStore.idSelectedOverlay === overlayId) {
      return handleSameOverlayNavigation(overlayId);
    }

    // AI : Optimization 2: Check if overlay is from the currently selected city
    const currentCity = mapStore.selectedCity;
    const isSameCity = currentCity?.id === cityId;

    if (isSameCity) {
      const corners = resolveOverlayCorners(overlayId);
      if (corners !== null) {
        return zoomToOverlayAndSelect(overlayId, corners, null, autoSelect); // AI : Same city, pass autoSelect
      }
      // AI : If null, fall through to different city path
    }

    // AI : Different city - load everything with cross-country flight support
    const switchToCountryLayer = await prepareNavigationToCity(cityId, cityName, countryCode);

    if (!map.value) {
      return false;
    }

    // AI : CRITICAL FIX: Use loadCityDataForNavigation to properly load city data
    // AI : This uses the same rendering pipeline as viewport manager
    // AI : forceFullOverlays=true because we're about to fly to high zoom
    const overlaysData = await loadCityDataForNavigation(cityId, true);

    // AI : Find the target overlay in the loaded data
    const overlayData = overlaysData?.find((o) => o.id === overlayId);

    if (overlayData !== undefined && overlayData.corners !== null) {
      return zoomToOverlayAndSelect(
        overlayId,
        overlayData.corners,
        switchToCountryLayer,
        autoSelect,
      );
    }

    // AI : If overlay still not found, return false
    return false;
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
  cityId: number,
  cityName: string,
  countryCode?: string,
  projectId?: string,
): Promise<void> {
  try {
    // AI : Prepare navigation with cross-country flight support
    const switchToCountryLayer = await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : CRITICAL FIX: Load city data to populate mapStore cache
    // AI : This is needed for CurrentLocationPanel to display projects
    // AI : Previously only overlays called this, causing standalone projects to not populate the panel
    await loadCityDataForNavigation(cityId, true);

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
