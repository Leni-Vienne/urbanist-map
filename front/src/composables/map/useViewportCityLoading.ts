import { ref } from "vue";
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

// AI : Zoom threshold - only load projects when zoomed in past this level
const VIEWPORT_ZOOM_THRESHOLD = 10;

// AI : Debounce delay for viewport changes (ms)
const VIEWPORT_DEBOUNCE_MS = 500;

// AI : Track currently loaded city IDs to avoid unnecessary reloads
const loadedCityIds = ref(new Set<number>());

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

  // AI : If zoomed out below threshold, clear all loaded cities
  if (currentZoom < VIEWPORT_ZOOM_THRESHOLD) {
    if (loadedCityIds.value.size > 0) {
      removeOverlayMarkers();
      clearAllOverlays();
      clearAllStandaloneProjectMarkers();
      loadedCityIds.value.clear();
    }
    return;
  }

  // AI : Get cities within current viewport bounds
  const citiesInViewport = getCitiesInViewport();
  const viewportCityIds = new Set(citiesInViewport.map((c) => c.id));

  // AI : Build set of cities to keep
  const currentLoadedIds = new Set(loadedCityIds.value);
  const citiesToKeep = new Set<number>();

  // AI : Add cities with markers in viewport
  viewportCityIds.forEach((id) => citiesToKeep.add(id));

  // AI : CRITICAL: Check ALL currently loaded cities for visible content
  // AI : This handles the case when zooming very close - city marker is out of view
  // AI : but overlay content is still visible
  for (const cityId of currentLoadedIds) {
    if (cityHasContentInViewport(cityId)) {
      citiesToKeep.add(cityId);
    }
  }

  // AI : Also check nearby cities (within expanded bounds) for visible content
  // AI : This handles panning back to areas with overlays
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

  // AI : Check if the set of cities has changed
  const hasChanges =
    citiesInViewport.some((city) => !currentLoadedIds.has(city.id)) ||
    [...currentLoadedIds].some((id) => !citiesToKeep.has(id)) ||
    [...citiesToKeep].some((id) => !currentLoadedIds.has(id)); // Cities to load that aren't loaded yet

  if (hasChanges) {
    // AI : Clear everything before loading new cities
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

        // AI : Render all overlays at once
        renderViewModeOverlays(visibleOverlays, true, true);

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

  // AI : Listen for zoom and pan end events
  map.value.on("zoomend", debouncedHandleViewportChange);
  map.value.on("moveend", debouncedHandleViewportChange);

  // AI : Initial check in case we're already zoomed in
  handleViewportChange();
}

/**
 * AI : Clean up viewport loading (remove event listeners)
 */
export function cleanupViewportCityLoading(): void {
  if (!map.value) return;

  map.value.off("zoomend", debouncedHandleViewportChange);
  map.value.off("moveend", debouncedHandleViewportChange);

  // AI : Clear loaded cities
  loadedCityIds.value.clear();
}
