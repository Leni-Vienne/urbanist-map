import L from "leaflet";
import { loadAllCityMarkersGlobally } from "@/services/map/cityMarkers";
import { loadCityProjects } from "@/services/navigation/locationNavigation";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { loadAndRenderCityData } from "@/services/navigation/cityNavigationTriggers";
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
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
  const liveLayer = overlayObject ? registry.getLayer(overlayObject.id) : null;
  if (liveLayer) {
    const corners = liveLayer.getCorners();
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
  const flightSkipped = mobileAwareFlyToBounds(bounds, {
    padding: [50, 50] as [number, number],
    duration: 1.5,
    easeLinearity: 0.25,
  });

  const overlayStore = useOverlayStore();

  // AI : Wait for element to exist, then wait for image to load before selecting
  // AI : This fixes the bug where first click adds blue outline but doesn't open toolbar
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

  // AI : If flight was skipped (camera already at target), select immediately without
  // AI : waiting for moveend — which will never fire since no animation was triggered.
  if (flightSkipped) {
    waitForElementThenSelect();
    return true;
  }

  map.value.once("moveend", () => {
    // AI : CRITICAL: After zoom completes, check if overlay needs to be rendered
    const overlayObj = overlayStore.overlays[overlayId];
    const overlayLayer = registry.getLayer(overlayId);
    if (overlayObj && !overlayLayer) {
      // AI : Layer was cleared (zoom-out pruning) but overlay data is still in the store.
      // AI : Re-render it and select it via onReady callback once the image is fully loaded.
      // AI : This avoids the polling loop that could spin forever if the layer never appears.
      // AI : If another render is already in flight (beginCreation returns false inside
      // AI : renderViewModeOverlays), fall back to the polling loop which will find the layer
      // AI : once that in-flight render completes.
      void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
        if (registry.hasReadyLayer(overlayId)) {
          // AI : Layer appeared between moveend and the async import resolving — select now
          if (autoSelect) selectOverlay(overlayId);
          return;
        }
        // AI : Pass createMarkers=true so the marker is (re)created if it was wiped by
        // AI : clearAll(preserveMarkers=false) when zooming out in view mode.
        // AI : createSingleMarker has a duplicate guard so this is safe if the marker exists.
        // AI : Without the marker, onOverlayFullyLoaded aborts and onReady is never called.
        const ourRenderStarted = renderViewModeOverlays(
          [overlayObj],
          true,
          false,
          autoSelect ? () => selectOverlay(overlayId) : undefined,
        );
        if (ourRenderStarted) {
          // AI : Our render is in flight with onReady wired — do NOT poll.
          // AI : waitForElementThenSelect would race: it calls selectOverlay before
          // AI : overlayStore.addOverlay runs (deferred via scheduleInitialization rAF queue),
          // AI : setting idSelectedOverlay early so onReady's selectOverlay hits the
          // AI : "already selected" early-exit guard and never opens the toolbar.
          return;
        }
        if (registry.hasReadyLayer(overlayId)) {
          // AI : Layer became ready between our render call and here (very fast completion)
          if (autoSelect) selectOverlay(overlayId);
          return;
        }
        if (registry.isCreating(overlayId)) {
          // AI : A different render (e.g. viewport loop) is in flight without our onReady —
          // AI : poll until it lands so we can select after it completes.
          waitForElementThenSelect();
          return;
        }
        // AI : renderViewModeOverlays was a no-op (e.g. zoom < MIN_ZOOM_FOR_OVERLAYS).
        // AI : Nothing we can do — the overlay can't be shown at this zoom level.
      });
      // AI : Do NOT call waitForElementThenSelect here — the onReady callback handles selection
      return;
    } else if (overlayLayer && !map.value.hasLayer(overlayLayer)) {
      const currentZoom = map.value.getZoom();
      // AI : CRITICAL: Only re-add if the overlay should be visible in the current mode
      // AI : This prevents adding a pending overlay back to the map when in view mode
      if (currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        const authStore = useAuthStore();
        if (overlayObj && isOverlayVisible(overlayObj, overlayStore.mode, authStore.user?.id)) {
          overlayLayer.addTo(map.value);
        }
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
      const isOverlayRendered = registry.getLayer(overlayId) !== null;

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
