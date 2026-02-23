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
import { requestScrollTo } from "@/services/layout/accordionState";

/**
 * AI : Resolve overlay corners with priority-based fallback
 * AI : Priority order:
 * AI : 1. Live Leaflet instance (if rendered on map - most current)
 * AI : 2. Edit mode cache (if user moved overlay in edit mode)
 * AI : 3. Mode-aware cache (backend data for current mode)
 * AI : 4. OverlayStore overlays object (fallback)
 * @param overlayId - ID of the overlay
 * @returns Corners array or null if overlay not found
 */
function resolveOverlayCorners(overlayId: string): { lat: number; lng: number }[] | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : Priority 1: Live Leaflet instance (most accurate, reflects current map state)
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.overlay) {
    const corners = overlayObject.overlay.getCorners();
    if (corners.length === 4) {
      return corners;
    }
  }

  // AI : Priority 2: Edit mode cache (user modifications not yet saved)
  const editCache = overlayStore.getFromEditModeCache(overlayId);
  if (editCache?.corners && editCache.corners.length === 4) {
    return editCache.corners;
  }

  // AI : Priority 3: Mode-aware cache (backend data for current mode)
  // AI : Need to search through all cached cities to find this overlay
  const currentMode = overlayStore.mode;
  for (const modeCache of mapStore.cityProjectsCache.values()) {
    const cachedData = modeCache.get(currentMode);
    if (cachedData) {
      const cachedOverlay = cachedData.find((o) => o.id === overlayId);
      if (cachedOverlay?.corners && cachedOverlay.corners.length === 4) {
        return cachedOverlay.corners;
      }
    }
  }

  // AI : Priority 4: Direct overlay object (fallback)
  if (overlayObject?.corners && overlayObject.corners.length === 4) {
    return overlayObject.corners;
  }

  return null;
}

/**
 * AI : Shared logic for navigating to a city, loading its cities and projects
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

    if (isNewCountryContext) {
      if (isDifferentCountry) {
        clearAllMapContent();
      }

      mapStore.selectedCountryCode = countryCode;

      // AI : Load country data for context and ensure global markers are visible
      // AI : Parallel execution for better performance
      await Promise.all([
        loadCitiesForCountry(countryCode),
        // AI : Always reload ALL global city markers to maintain global context
        loadAllCityMarkersGlobally(),
      ]);
    }
  }

  // AI : Set selected city state (overlays are rendered separately via loadAndRenderCityData)
  loadCityProjects(cityId, cityName, null, countryCode);
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
  if (corners.length !== 4) return false;

  const bounds = L.latLngBounds(corners.map((c) => L.latLng(c.lat, c.lng)));
  mobileAwareFlyToBounds(bounds, {
    padding: [50, 50] as [number, number],
    duration: 1.5,
    easeLinearity: 0.25,
  });

  const overlayStore = useOverlayStore();

  map.value.once("moveend", () => {
    // AI : CRITICAL: After zoom completes, check if overlay needs to be rendered
    const overlayObj = overlayStore.overlays[overlayId];
    if (overlayObj && !overlayObj.overlay) {
      console.warn(`Overlay ${overlayId} exists in store but has no Leaflet overlay`);
    } else if (overlayObj?.overlay && !map.value.hasLayer(overlayObj.overlay)) {
      const currentZoom = map.value.getZoom();
      if (currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        overlayObj.overlay.addTo(map.value);
      }
    }

    // AI : Wait for element to exist, then wait for image to load before selecting
    // AI : This fixes the bug where first click adds blue outline but doesn't open toolbar
    function waitForElementThenSelect(): void {
      const overlayObj = overlayStore.overlays[overlayId];
      const element = overlayObj?.overlay?.getElement();

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
    zoomToOverlayAndSelect(overlayId, corners, autoSelect);
  }
  return true;
}

/**
 * AI : Navigates to an overlay by simulating the complete marker click flow
 * AI : This replicates what happens when clicking a city marker → overlay
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
      const overlayObj = overlayStore.overlays[overlayId];
      const isOverlayRendered = overlayObj?.overlay !== null && overlayObj?.overlay !== undefined;

      if (isOverlayRendered) {
        const corners = resolveOverlayCorners(overlayId);
        if (corners !== null) {
          return zoomToOverlayAndSelect(overlayId, corners, autoSelect);
        }
      }
      // AI : Overlay not rendered (cleared on unzoom), fall through to reload city data
    }

    // AI : Different city - load everything with cross-country flight support
    await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : CRITICAL FIX: Use loadAndRenderCityData to properly load city data
    const result = await loadAndRenderCityData(cityId, true);

    const matchingOverlay = result.overlays.find((o) => o.id === overlayId);

    if (!matchingOverlay || matchingOverlay.project?.cityId !== cityId) {
      console.warn(
        `Overlay ${overlayId} not found in city ${cityId} or doesn't belong to this city`,
      );
    }

    if (matchingOverlay?.corners && matchingOverlay.corners.length === 4) {
      zoomToOverlayAndSelect(overlayId, matchingOverlay.corners, autoSelect);
    } else {
      console.warn(`Cannot navigate to overlay ${overlayId} - missing corners`);
    }

    return false;
  } catch (error) {
    console.error("Failed to navigate to overlay with city:", error);
    throw error;
  }
}

/**
 * AI : Navigates to a marker project by simulating the complete marker click flow
 * AI : This replicates what happens when clicking a city marker
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
    await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : CRITICAL FIX: Load city data to populate mapStore cache
    await loadAndRenderCityData(cityId, true);

    await new Promise<void>((resolve) => void setTimeout(() => resolve(), 200));

    // AI : Request scroll to project in adjacent panels IMMEDIATELY after data is loaded
    if (projectId) {
      requestScrollTo("project", projectId);
    }

    mobileAwareFlyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25,
    });

    map.value.once("moveend", () => {
      if (projectId) {
        const overlayStore = useOverlayStore();
        const uiStore = useUiStore();

        const marker = getStandaloneProjectMarkerByProjectId(projectId);
        if (!marker) return;

        createProjectInfoTeleportTarget(marker);
        updateStandaloneProjectMarkerOpacities(marker);

        if (overlayStore.showInfoPopup) {
          overlayStore.hideInfoPopup();
        }

        uiStore.openProjectInfoPopup(projectId);
      }
    });
  } catch (error) {
    console.error("Failed to navigate to marker project:", error);
    throw error;
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
