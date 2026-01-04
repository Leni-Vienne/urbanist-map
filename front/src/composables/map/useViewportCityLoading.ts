import { ref, watch } from "vue";
import L from "leaflet";
import { map } from "@/composables/core/useMap";
import { debounce } from "@/utils/debounce";
import { fetchCityDataForViewport, type CityWithProjects } from "@/composables/map/useCityMarkers";
import {
  removeOverlayMarkers,
  renderOverlayMarkersFromData,
} from "@/composables/map/useCityOverlays";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import {
  clearAllStandaloneProjectMarkers,
  addStandaloneProjectMarkerForProject,
  removeStandaloneProjectMarkerForProject,
  getStandaloneProjectMarkerMap,
  getStandaloneProjectMarkerByProjectId,
} from "@/composables/map/useStandaloneProjectMarkers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlay";
import { useCompletionFilters } from "@/composables/overlay/useCompletionFilters";
import type { OverlayData, OverlayObject } from "@/types/index";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { resolveOverlayCorners } from "@/composables/overlay/useOverlayPositionResolver";

// AI : Zoom threshold - only load projects when zoomed in past this level

// AI : Debounce delay for viewport changes (ms)
const VIEWPORT_DEBOUNCE_MS = 500;

// AI : Track currently loaded city IDs to avoid unnecessary reloads
const loadedCityIds = ref(new Set<number>());

// AI : Track previous zoom state to detect threshold crossings
let wasAboveViewportThreshold = false;
let wasAboveImageThreshold = false; // NEW: track image threshold separately
let previousMode: "view" | "edit" | "moderation" = "view"; // Track mode changes

// AI : Version counter to prevent race conditions with rapid mode changes
// AI : Each viewport change operation gets a unique version number
// AI : If version mismatches during async operations, the operation is stale and should abort
let currentOperationVersion = 0;

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
  const overlayStore = useOverlayStore();

  // Helper to check intersection for a set of corners
  const checkIntersection = (corners: { lat: number; lng: number }[] | undefined | null) => {
    if (corners && corners.length > 0) {
      const overlayBounds = L.latLngBounds(corners.map((c) => [c.lat, c.lng] as [number, number]));
      if (bounds.intersects(overlayBounds)) {
        return true;
      }
    }
    return false;
  };

  // AI : 1. Check cached overlays using position resolver
  // AI : Position resolver handles priority: Leaflet > Edit Cache > Mode Cache > Backend
  const cachedOverlays = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (cachedOverlays) {
    for (const cachedOverlay of cachedOverlays) {
      const corners = resolveOverlayCorners(cachedOverlay.id);
      if (checkIntersection(corners)) return true;
    }
  }

  // AI : 2. Check active overlays (covering brand new items not in cache)
  const activeOverlays = Object.values(overlayStore.overlays) as OverlayObject[];
  for (const overlay of activeOverlays) {
    if ((overlay as any).cityId === cityId) {
      const corners = resolveOverlayCorners(overlay.id);
      if (checkIntersection(corners)) return true;
    }
  }

  // AI : 3. Check standalone projects
  const cachedProjects = mapStore.getCityStandaloneProjectsCache(cityId, overlayStore.mode);
  if (cachedProjects) {
    for (const project of cachedProjects) {
      // Check for active marker override (if dragged/moved)
      const marker = getStandaloneProjectMarkerByProjectId(project.id);
      let lat = project.lat;
      let lng = project.lng;

      if (marker) {
        const markerLatLng = marker.getLatLng();
        lat = markerLatLng.lat;
        lng = markerLatLng.lng;
      }

      if (lat !== null && lng !== null && bounds.contains([lat, lng])) {
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

  // AI : Increment version counter for this operation to detect stale operations
  // AI : If mode changes rapidly, only the latest operation should complete
  currentOperationVersion++;
  const operationVersion = currentOperationVersion;

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
      // AI : CRITICAL: When only mode changes, pre-fetch and cache data for new mode
      // AI : This populates the cache WITHOUT re-rendering (prevents flicker)
      // AI : When user zooms later, data will already be cached
      isLoadingViewport.value = true;
      try {
        // AI : Fetch data from all loaded cities in parallel (cache population only)
        await Promise.all(
          Array.from(citiesToKeep).map((cityId) => fetchCityDataForViewport(cityId)),
        );

        // AI : Check if this operation is stale (mode changed again during fetch)
        if (operationVersion !== currentOperationVersion) {
          return; // Abort stale operation, newer one is in progress
        }

        // AI : Data is now cached via fetchCityDataForViewport's internal caching
        // AI : Don't re-render anything - existing overlays stay as-is
      } finally {
        isLoadingViewport.value = false;
      }
      return; // Exit early, keep visual state as-is
    }

    // AI : Cities or zoom changed - reload viewport content
    // AI : NOTE: We defer clearing logic to AFTER loading to prevent visual flickering
    // removeOverlayMarkers();
    // clearAllOverlays();
    // clearAllStandaloneProjectMarkers();
    // loadedCityIds.value.clear();

    // AI : Load ALL cities that should be visible (marker in viewport OR content in viewport)
    if (citiesToKeep.size > 0) {
      isLoadingViewport.value = true;
      try {
        // AI : Fetch data from all cities in parallel
        const cityDataResults = await Promise.all(
          Array.from(citiesToKeep).map((cityId) => fetchCityDataForViewport(cityId)),
        );

        // AI : Check if this operation is stale (viewport/mode changed during fetch)
        if (operationVersion !== currentOperationVersion) {
          return; // Abort stale operation, newer one is in progress
        }

        // AI : Collect all overlays and projects
        const allOverlays = cityDataResults.flatMap((result) => result.overlays);
        const allProjects = cityDataResults.flatMap((result) => result.projects);

        // AI : Filter overlays by completion status
        const filters = useCompletionFilters();
        const visibleOverlays = filters.filterByCompletionStatus(allOverlays) as OverlayData[];

        // AI : DECISION: What to render based on current zoom
        const currentZoom = map.value.getZoom();
        const shouldShowFullOverlays = currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

        // AI : 1. Sync Overlays (Full Images vs Markers)
        syncOverlays(visibleOverlays, shouldShowFullOverlays);

        // AI : 2. Sync Standalone Project Markers (for empty projects)
        await syncStandaloneProjects(allProjects, allOverlays);

        // AI : Final check before updating state (in case mode changed during sync)
        if (operationVersion !== currentOperationVersion) {
          return; // Abort stale operation before updating state
        }

        // AI : Update loadedCityIds finally (Replace the set instead of just adding)
        loadedCityIds.value = new Set(citiesToKeep);
      } finally {
        isLoadingViewport.value = false;
      }
    }
  }
}

/**
 * AI : Sync overlays based on zoom level (Full Images vs Markers)
 * AI : Handles exact differential updates to avoid flickering
 * AI : NOTE: This is only called when viewport/cities/zoom changed (not for mode-only changes)
 * AI : Mode-only changes are handled separately with early return to avoid re-rendering
 */
function syncOverlays(visibleOverlays: OverlayData[], shouldShowFullOverlays: boolean) {
  const overlayStore = useOverlayStore();

  if (shouldShowFullOverlays) {
    // AI : Zoom is high enough - render full overlay images

    // AI : 1. Render new view mode overlays (this updates existing ones and adds new ones)
    // AI : We do this BEFORE removing old ones to ensure seamless transition
    // AI : setViewModeOverlays updates the store, renderViewModeOverlays updates the map
    // AI : Force re-render since viewport/cities/zoom changed (not a mode-only change)
    overlayStore.setViewModeOverlays(visibleOverlays);
    renderViewModeOverlays(visibleOverlays, true, true);

    // AI : 2. Remove "dumb" overlay markers since we now show full overlays
    removeOverlayMarkers();

    // AI : 3. Remove overlays that are no longer visible (from unloaded cities or filtered out)
    // AI : Identify specific overlays to remove instead of clearing all
    const visibleOverlayIds = new Set(visibleOverlays.map((o) => o.id));
    const currentOverlays = overlayStore.overlays;

    Object.keys(currentOverlays).forEach((id) => {
      if (!visibleOverlayIds.has(id)) {
        overlayStore.removeOverlay(id);
      }
    });
  } else {
    // AI : Zoom too low - render overlay markers only (no images)

    // AI : 1. Render overlay markers first
    // AI : This handles both adding new markers and clearing the old marker layer internally
    renderOverlayMarkersFromData(visibleOverlays);

    // AI : 2. Clear full overlays as they are replaced by markers
    clearAllOverlays();
  }
}

/**
 * AI : Sync standalone project markers (projects without overlays)
 * AI : Handles differential updates to avoid flickering
 */
async function syncStandaloneProjects(allProjects: any[], allOverlays: any[]) {
  // AI : Only render standalone markers for projects WITHOUT overlays
  const projectIdsWithOverlays = new Set(allOverlays.map((o: any) => o.projectId).filter(Boolean));
  const standaloneProjects = allProjects.filter(
    (project: any) => !projectIdsWithOverlays.has(project.id),
  );

  // AI : SYNC logic: Remove old markers that aren't in the new list, add new ones
  const currentMarkers = getStandaloneProjectMarkerMap();
  const newProjectIds = new Set(standaloneProjects.map((p: any) => p.id));

  // 1. Remove markers not in new list
  currentMarkers.forEach((_, projectId) => {
    if (!newProjectIds.has(projectId)) {
      removeStandaloneProjectMarkerForProject(projectId);
    }
  });

  // 2. Add new markers
  standaloneProjects.forEach((project: any) => {
    addStandaloneProjectMarkerForProject(project);
  });
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
