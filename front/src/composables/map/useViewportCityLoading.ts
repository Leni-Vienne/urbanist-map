import { ref, watch } from "vue";
import { map } from "@/composables/core/useMap";
import { debounce } from "@/utils/debounce";
import type { CityWithProjects } from "@/composables/map/useCityMarkers";
import { fetchCityDataForViewport } from "@/composables/map/useCityMarkers";
import { removeOverlayMarkers } from "@/composables/map/useCityOverlays";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import {
  clearAllStandaloneProjectMarkers,
  addStandaloneProjectMarkerForProject,
} from "@/composables/map/useStandaloneProjectMarkers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlay";
import { useCompletionFilters } from "@/composables/overlay/useCompletionFilters";
import type { OverlayData } from "@/types/index";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { checkZoomAndHideOverlays } from "@/composables/map/useCityOverlays";

// AI : Zoom threshold - only load projects when zoomed in past this level

// AI : Debounce delay for viewport changes (ms)
const VIEWPORT_DEBOUNCE_MS = 500;

// AI : Track currently loaded city IDs to avoid unnecessary reloads
const loadedCityIds = ref(new Set<number>());

// AI : Track previous zoom state to detect threshold crossings
let wasAboveViewportThreshold = false;
let wasAboveImageThreshold = false; // NEW: track image threshold separately
let previousMode: "view" | "edit" | "moderation" = "view"; // Track mode changes

// AI : Loading state for viewport-based loading
export const isLoadingViewport = ref(false);

// AI : All city markers available for viewport detection
let allCityMarkers: CityWithProjects[] = [];

/**
 * AI : Set all city markers for viewport detection
 */
export function setAllCityMarkers(cities: CityWithProjects[]): void {
  allCityMarkers = cities;
}

/**
 * AI : Get cities within the current viewport bounds
 * AI : More accurate than circular distance - only loads cities actually visible
 */
function getCitiesInViewport(): CityWithProjects[] {
  if (!map.value) return [];

  // AI : Get the current map bounds (southwest and northeast corners)
  const bounds = map.value.getBounds();

  // AI : Filter cities that fall within the viewport rectangle
  return allCityMarkers.filter((city) => bounds.contains([city.lat, city.lng]));
}

/**
 * AI : Check if a city has any content (overlays or projects) visible in viewport
 * AI : This prevents unloading cities when zoomed into their overlays/projects
 */
function cityHasContentInViewport(cityId: number): boolean {
  if (!map.value) return false;

  const bounds = map.value.getBounds();
  const mapStore = useMapStore();

  // AI : Check if any overlays from this city are in the cache
  const overlays = mapStore.getCityOverlaysAndProjectsCache(cityId, useOverlayStore().mode);
  if (overlays) {
    // AI : Check if ANY corner of any overlay is within bounds
    // AI : This is better than just checking centroid - works when zoomed very close
    for (const overlay of overlays) {
      if (overlay.corners) {
        // AI : Check all 4 corners - if any is visible, keep the city loaded
        for (const corner of overlay.corners) {
          if (corner.lat && corner.lng && bounds.contains([corner.lat, corner.lng])) {
            return true;
          }
        }
      }
    }
  }

  // AI : Check if any standalone projects from this city are in bounds
  const projects = mapStore.getCityStandaloneProjectsCache(cityId, useOverlayStore().mode);
  if (projects) {
    for (const project of projects) {
      // AI : lat/lng can be null for projects without coordinates
      if (
        project.lat !== null &&
        project.lng !== null &&
        bounds.contains([project.lat, project.lng])
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * AI : Handle viewport changes - load/unload cities based on current view
 */
async function handleViewportChange(): Promise<void> {
  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  // AI : Check if we crossed the viewport threshold (important for reload after zoom out/in)
  const isAboveViewportThreshold = currentZoom >= MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD;
  const crossedViewportThreshold = wasAboveViewportThreshold !== isAboveViewportThreshold;

  // AI : Check if we crossed the image threshold (markers ↔ full images)
  const isAboveImageThreshold = currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;
  const crossedImageThreshold = wasAboveImageThreshold !== isAboveImageThreshold;

  // AI : If zoomed out below threshold, clear all loaded cities
  if (currentZoom < MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD) {
    if (loadedCityIds.value.size > 0) {
      removeOverlayMarkers();
      clearAllOverlays();
      clearAllStandaloneProjectMarkers();
      loadedCityIds.value.clear();
    }
    wasAboveViewportThreshold = false;
    wasAboveImageThreshold = false;
    return;
  }

  // AI : Update threshold states for next check
  wasAboveViewportThreshold = true;
  wasAboveImageThreshold = isAboveImageThreshold;

  // AI : Check if mode changed (view ↔ edit)
  const overlayStore = useOverlayStore();
  const currentMode = overlayStore.mode;
  const modeChanged = previousMode !== currentMode;
  previousMode = currentMode;

  // AI : Get cities within current viewport bounds
  const citiesInViewport = getCitiesInViewport();
  const viewportCityIds = new Set(citiesInViewport.map((c) => c.id));

  // AI : Start with cities currently in viewport
  const currentLoadedIds = new Set(loadedCityIds.value);
  const citiesToKeep = new Set<number>();

  // AI : CRITICAL: If mode changed, keep ALL currently loaded cities
  // AI : This prevents clearing when zoomed close (city marker off-screen but content visible)
  if (modeChanged && currentLoadedIds.size > 0) {
    currentLoadedIds.forEach((id) => citiesToKeep.add(id));
  } else {
    // AI : Normal case: add cities with markers in viewport
    viewportCityIds.forEach((id) => citiesToKeep.add(id));
  }

  // AI : Also keep cities that have visible content even if marker is outside viewport
  for (const cityId of currentLoadedIds) {
    if (cityHasContentInViewport(cityId)) {
      citiesToKeep.add(cityId);
    }
  }

  // AI : Expand search bounds to include nearby cities with visible content
  if (map.value) {
    const bounds = map.value.getBounds();
    const expandedBounds = bounds.pad(0.5); // Expand by 50% in each direction

    // AI : Check cities near viewport for visible content
    for (const city of allCityMarkers) {
      // AI : Skip if already added
      if (citiesToKeep.has(city.id)) continue;

      // AI : Only check cities reasonably close to viewport
      if (!expandedBounds.contains([city.lat, city.lng])) continue;

      // AI : Check if this city has visible content
      if (cityHasContentInViewport(city.id)) {
        citiesToKeep.add(city.id);
      }
    }
  }

  // AI : Check if the set of cities has changed OR if we crossed viewport/image thresholds OR mode changed
  const hasChanges =
    citiesInViewport.some((city) => !currentLoadedIds.has(city.id)) ||
    [...currentLoadedIds].some((id) => !citiesToKeep.has(id)) ||
    [...citiesToKeep].some((id) => !currentLoadedIds.has(id)) || // Cities to load that aren't loaded yet
    crossedViewportThreshold || // Reload when crossing viewport threshold
    crossedImageThreshold || // Re-render when crossing image threshold
    modeChanged; // NEW: Re-render when mode changes

  if (hasChanges) {
    // AI : Check if ONLY mode changed (no city/zoom changes)
    // AI : If so, don't clear overlays - just refetch to update visibility/permissions
    const citiesAreSame =
      citiesToKeep.size === currentLoadedIds.size &&
      [...citiesToKeep].every((id) => currentLoadedIds.has(id));

    const onlyModeChanged =
      modeChanged && !crossedViewportThreshold && !crossedImageThreshold && citiesAreSame; // Same cities = don't destroy overlays

    if (onlyModeChanged) {
      // AI : CRITICAL: When only mode changes, don't reload anything
      // AI : The existing overlays are fine - mode change just affects visibility/permissions
      // AI : Reloading causes flicker and complexity with timing issues
      return; // Exit early, keep everything as-is
    }

    // AI : Cities or zoom changed - clear and reload everything
    removeOverlayMarkers();
    clearAllOverlays();
    clearAllStandaloneProjectMarkers();
    loadedCityIds.value.clear();

    // AI : Load ALL cities that should be visible (marker in viewport OR content in viewport)
    if (citiesToKeep.size > 0) {
      isLoadingViewport.value = true;
      try {
        // AI : Fetch data from all cities in parallel
        const cityDataResults = await Promise.all(
          Array.from(citiesToKeep).map((cityId) => fetchCityDataForViewport(cityId)),
        );

        // AI : Collect all overlays and projects
        const allOverlays = cityDataResults.flatMap((result) => result.overlays);
        const allProjects = cityDataResults.flatMap((result) => result.projects);

        // AI : Filter overlays by completion status
        const filters = useCompletionFilters();
        const visibleOverlays = filters.filterByCompletionStatus(allOverlays) as OverlayData[];

        // AI : Set view mode overlays in store
        const overlayStore = useOverlayStore();
        overlayStore.setViewModeOverlays(visibleOverlays);

        // AI : Decide what to render based on current zoom (matches pattern from loadCityOverlays)
        const currentZoom = map.value.getZoom();
        const shouldShowFullOverlays = currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

        if (shouldShowFullOverlays) {
          // AI : Zoom is high enough - render full overlay images
          // AI : Remove overlay markers first (matches pattern from loadCityOverlays)
          const { removeOverlayMarkers } = await import("@/composables/map/useCityOverlays");
          removeOverlayMarkers();

          // AI : If only mode changed, don't force re-render (preserves existing overlays)
          // AI : Otherwise force re-render to ensure fresh state
          renderViewModeOverlays(visibleOverlays, true, !onlyModeChanged);
        } else {
          // AI : Zoom too low - render overlay markers only (no images)
          const { renderOverlayMarkersFromData } =
            await import("@/composables/map/useCityOverlays");
          renderOverlayMarkersFromData(visibleOverlays);
        }

        // AI : Only render standalone markers for projects WITHOUT overlays
        const projectIdsWithOverlays = new Set(
          allOverlays.map((o: any) => o.projectId).filter(Boolean),
        );
        const standaloneProjects = allProjects.filter(
          (project: any) => !projectIdsWithOverlays.has(project.id),
        );

        // AI : Render standalone project markers
        standaloneProjects.forEach((project: any) => {
          addStandaloneProjectMarkerForProject(project);
        });

        // AI : Mark all cities as loaded
        citiesToKeep.forEach((cityId) => loadedCityIds.value.add(cityId));
      } finally {
        isLoadingViewport.value = false;
      }
    }
  }
}

// AI : Debounced version of viewport change handler
const debouncedHandleViewportChange = debounce(handleViewportChange, VIEWPORT_DEBOUNCE_MS);

/**
 * AI : Initialize viewport-based city loading
 * AI : Sets up event listeners on the map for zoom and pan events
 */
export function initializeViewportCityLoading(): void {
  if (!map.value) {
    console.error("Map not initialized when trying to set up viewport loading");
    return;
  }

  // AI : Handle zoom immediately (no debounce) - zoom is discrete, user stops on specific levels
  // AI : This prevents missing cities when zooming quickly past the threshold
  map.value.on("zoomend", handleViewportChange);

  // AI : Debounce pan events - panning is continuous and can fire very frequently
  map.value.on("moveend", debouncedHandleViewportChange);

  // AI : Watch for mode changes and trigger viewport reload
  // AI : Mode changes don't fire map events, so we need a separate watcher
  const overlayStore = useOverlayStore();
  watch(
    () => overlayStore.mode,
    () => {
      handleViewportChange();
    },
  );

  // AI : Initial check in case we're already zoomed in
  handleViewportChange();
}

/**
 * AI : Clean up viewport loading (remove event listeners)
 */
export function cleanupViewportCityLoading(): void {
  if (!map.value) return;

  map.value.off("zoomend", handleViewportChange);
  map.value.off("moveend", debouncedHandleViewportChange);

  // AI : Clear loaded cities
  loadedCityIds.value.clear();
}
