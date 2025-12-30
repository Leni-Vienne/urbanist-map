import { ref } from "vue";
import L from "leaflet";
import { map } from "@/composables/core/useMap";
import { debounce } from "@/utils/debounce";
import type { CityWithProjects } from "@/composables/map/useCityMarkers";
import { loadCityProjectsForViewport } from "@/composables/map/useCityMarkers";
import { removeOverlayMarkers } from "@/composables/map/useCityOverlays";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/composables/map/useStandaloneProjectMarkers";

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
 * AI : Get cities within distance threshold from map center
 * AI : Distance threshold scales with zoom level
 */
function getCitiesNearCenter(): CityWithProjects[] {
  if (!map.value) return [];

  const mapCenter = map.value.getCenter();
  const currentZoom = map.value.getZoom();

  // AI : Distance threshold (in degrees) scales with zoom
  // AI : Higher zoom = smaller radius (more zoomed in = smaller area)
  // AI : Increased thresholds to load more cities and show multiple projects
  let maxDistance: number;
  if (currentZoom >= 14) {
    maxDistance = 0.3; // Very zoomed in - ~33km radius
  } else if (currentZoom >= 12) {
    maxDistance = 0.6; // Zoomed in - ~66km radius
  } else if (currentZoom >= 10) {
    maxDistance = 1.5; // Medium zoom - ~165km radius
  } else {
    maxDistance = 3.0; // Zoomed out - ~330km radius
  }

  // AI : Filter and sort cities by distance from center
  return allCityMarkers
    .map((city) => ({
      city,
      distance: Math.sqrt(
        Math.pow(city.lat - mapCenter.lat, 2) + Math.pow(city.lng - mapCenter.lng, 2),
      ),
    }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.city);
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

  // AI : Get cities near map center (pure distance-based)
  const citiesNearCenter = getCitiesNearCenter();
  const nearCityIds = new Set(citiesNearCenter.map((c) => c.id));

  // AI : Check if the set of cities has changed
  const currentLoadedIds = new Set(loadedCityIds.value);
  const hasChanges =
    citiesNearCenter.some((city) => !currentLoadedIds.has(city.id)) ||
    [...currentLoadedIds].some((id) => !nearCityIds.has(id));

  if (hasChanges) {
    // AI : Clear everything before loading new cities
    removeOverlayMarkers();
    clearAllOverlays();
    clearAllStandaloneProjectMarkers();
    loadedCityIds.value.clear();

    // AI : Load all cities that should be visible
    if (citiesNearCenter.length > 0) {
      isLoadingViewport.value = true;
      try {
        // AI : FETCH all city data in parallel (no rendering yet)
        const { fetchCityDataForViewport } = await import("@/composables/map/useCityMarkers");
        const cityDataResults = await Promise.all(
          citiesNearCenter.map((city) => fetchCityDataForViewport(city.id)),
        );

        // AI : Collect all overlays and projects from all cities
        const allOverlays = cityDataResults.flatMap((result) => result.overlays);
        const allProjects = cityDataResults.flatMap((result) => result.projects);

        // AI : NOW render everything ONCE in batch
        const { renderViewModeOverlays } = await import("@/composables/overlay/useOverlay");
        const { useCompletionFilters } = await import("@/composables/overlay/useCompletionFilters");
        const { useOverlayStore } = await import("@/stores/pinia/overlayStore");
        const { addStandaloneProjectMarkerForProject } =
          await import("@/composables/map/useStandaloneProjectMarkers");

        // AI : Filter overlays by completion status
        const completionFilters = useCompletionFilters();
        const visibleOverlays = completionFilters.filterByCompletionStatus(allOverlays);

        // AI : Set view mode overlays in store
        const overlayStore = useOverlayStore();
        overlayStore.setViewModeOverlays(visibleOverlays);

        // AI : Render all overlays at once
        renderViewModeOverlays(visibleOverlays, true, true);

        // AI : Only render standalone markers for projects WITHOUT overlays
        // AI : Create a Set of project IDs that have overlays
        const projectIdsWithOverlays = new Set(
          allOverlays.map((o: any) => o.projectId).filter(Boolean),
        );

        // AI : Filter projects to only those without overlays (standalone projects)
        const standaloneProjects = allProjects.filter(
          (project: any) => !projectIdsWithOverlays.has(project.id),
        );

        // AI : Render standalone project markers
        standaloneProjects.forEach((project: any) => {
          addStandaloneProjectMarkerForProject(project);
        });

        // AI : Mark all cities as loaded
        citiesNearCenter.forEach((city) => loadedCityIds.value.add(city.id));
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
