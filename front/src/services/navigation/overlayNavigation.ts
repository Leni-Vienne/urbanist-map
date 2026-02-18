import L from "leaflet";
import { loadAllCityMarkersGlobally } from "@/services/map/cityMarkers";
import { loadCityProjects } from "@/services/navigation/locationNavigation";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { loadAndRenderCityData } from "@/services/navigation/cityDataRenderer";
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerOpacities,
} from "@/services/map/standaloneProjectMarkers";
import { createProjectInfoTeleportTarget } from "@/services/map/projectPopupTeleport";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { resolveOverlayCorners } from "@/services/overlay/overlayPositionResolver";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayData } from "@/types/index";

/**
 * AI : Shared logic for navigating to a location by simulating country → city marker clicks
 * AI : This loads the country cities, adds city markers, and load city projects
 * @returns Callback to switch to country layer after flight, or null if not cross-country
 */
async function prepareNavigationToCity(
  cityId: number,
  cityName: string,
  countryCode?: string,
): Promise<void> {
  if (countryCode) {
    const mapStore = useMapStore();
    // AI : Only clear when switching from one DEFINED country to a DIFFERENT country
    // AI : Don't clear when selectedCountryCode is undefined (global city markers loaded)
    const isDifferentCountry =
      mapStore.selectedCountryCode !== null && mapStore.selectedCountryCode !== countryCode;

    // AI : Check if we need to update the country context (new selection or initial selection)
    const isNewCountryContext = isDifferentCountry || !mapStore.selectedCountryCode;

    // AI : Step 1: Prepare for cross-country flight (switches to esri if needed)
    // prepareCrossCountryFlight(countryCode); // AI : Removed as part of cleanup

    if (isNewCountryContext) {
      // AI : Step 2: Only clear map content when acting switching countries
      // AI : This prevents unnecessary removal of city markers when navigating within the same country
      if (isDifferentCountry) {
        clearAllMapContent();
      }

      mapStore.selectedCountryCode = countryCode;

      // AI : Load country data for context and ensure global markers are visible
      // AI : Parallel execution for better performance
      await Promise.all([
        loadCitiesForCountry(countryCode),
        // AI : Always reload ALL global city markers to maintain global context
        // AI : This fixes city markers appearing only for the current country or disappearing
        loadAllCityMarkersGlobally(),
      ]);
    }
  }

  // AI : Step 3: Simulate city marker click (this loads and renders all markers and overlays for the city)
  // AI : Use forceFullLoad=true to ensure overlays render even if current zoom is low
  // AI : This is necessary because we're about to fly to an overlay which requires the full overlay to exist
  await loadCityProjects(cityId, cityName, null, true, countryCode);
}

/**
 * AI : Zoom to overlay and optionally select it once rendered
 * @param autoSelect - Whether to auto-select the overlay after zoom (default: true)
 */
function zoomToOverlayAndSelect(
  overlayId: string,
  corners: { lat: number; lng: number }[],
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
function handleSameOverlayNavigation(overlayId: string, autoSelect: boolean): boolean {
  const corners = resolveOverlayCorners(overlayId);
  if (corners !== null) {
    zoomToOverlayAndSelect(overlayId, corners, autoSelect); // AI : Same overlay, no cross-country
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
      return handleSameOverlayNavigation(overlayId, autoSelect);
    }

    // AI : Optimization 2: Check if overlay is from the currently selected city
    const currentCity = mapStore.selectedCity;
    const isSameCity = currentCity?.id === cityId;

    if (isSameCity) {
      // AI : Additional check: verify overlay is actually rendered, not just cached
      // AI : City data is cleared when zooming out below threshold, so we need to check
      // AI : if the Leaflet overlay exists before using the quick path
      const overlayObj = overlayStore.overlays[overlayId];
      const isOverlayRendered = overlayObj?.overlay !== null && overlayObj?.overlay !== undefined;

      if (isOverlayRendered) {
        const corners = resolveOverlayCorners(overlayId);
        if (corners !== null) {
          return zoomToOverlayAndSelect(overlayId, corners, autoSelect); // AI : Same city, pass autoSelect
        }
      }
      // AI : Overlay not rendered (cleared on unzoom), fall through to reload city data
    }

    // AI : Different city - load everything with cross-country flight support
    await prepareNavigationToCity(cityId, cityName, countryCode);

    if (map.value === null) {
      return false;
    }

    // AI : CRITICAL FIX: Use loadAndRenderCityData to properly load city data
    // AI : This must happen BEFORE the flight animation to ensure the data is loaded
    // AI : even if the user interrupts the animation
    const result = await loadAndRenderCityData(cityId, true);

    const overlaysData = result?.overlays;

    // AI : Find the overlay in the fetched data
    let matchingOverlay: OverlayData | undefined = undefined;
    if (overlaysData) {
      matchingOverlay = overlaysData.find((o: OverlayData) => o.id === overlayId);
    }

    // AI : Check if the overlay exists and belongs to the correct city
    if (!matchingOverlay || matchingOverlay.project?.cityId !== cityId) {
      console.warn(
        `Overlay ${overlayId} not found in city ${cityId} or doesn't belong to this city`,
      );
      // AI : Still fly to coordinates to show the general area
    }

    // AI : Always fly to the overlay when navigating between cities
    // AI : We know we are far away (different city), so we don't check current zoom level
    if (matchingOverlay?.corners && matchingOverlay.corners.length === 4) {
      zoomToOverlayAndSelect(overlayId, matchingOverlay.corners, autoSelect);
    } else {
      console.warn(`Cannot navigate to overlay ${overlayId} - missing corners`);
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
    await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : CRITICAL FIX: Load city data to populate mapStore cache
    // AI : This is needed for CurrentLocationPanel to display projects
    // AI : Previously only overlays called this, causing standalone projects to not populate the panel
    await loadAndRenderCityData(cityId, true);

    // AI : Wait a bit for markers to be added to the map
    await new Promise((resolve) => setTimeout(resolve, 200));

    // AI : Request scroll to project in adjacent panels IMMEDIATELY after data is loaded
    // AI : This ensures the accordion opens while the flight is happening, providing instant feedback
    if (projectId) {
      requestScrollTo("project", projectId);
    }

    // AI : Fly to marker project coordinates
    if (map.value === null) {
      throw new Error("Map is not initialized");
    }

    mobileAwareFlyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // AI : Handle post-flight actions
    map.value.once("moveend", () => {
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

// AI : Accept HMR updates for this module
if (import.meta.hot) {
  import.meta.hot.accept();
}
