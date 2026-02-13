// AI : Viewport-based content manager - replaces city-based loading with spatial queries
// AI : Single rendering path for all triggers (pan, zoom, mode switch, navigation)
import { ref, watch } from "vue";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { debounce } from "@/utils/debounce";
import {
  updateOverlayEditingState,
  saveAllOverlaysToCache,
} from "@/services/overlay/overlayEditing";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { pruneMapEntities } from "@/services/map/viewportPruning";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { renderOverlayMarkersFromData, removeOverlayMarkers } from "@/services/map/cityOverlays";
import { citiesWithProjects } from "@/services/map/cityMarkers";
import {
  addStandaloneProjectMarkerForProject,
  clearAllStandaloneProjectMarkers,
  getStandaloneProjectMarkerMap,
} from "@/services/map/standaloneProjectMarkers";
import {
  loadedCityIds,
  fetchCityStandaloneProjectsOrCache,
} from "@/services/navigation/cityDataLoader";
import type { OverlayData, OverlayObject } from "@/types/index";
import {
  createProjectObject,
  toProjectPartial,
  type StandaloneProject,
} from "@/utils/typeFactories";
import type { AppMode } from "@shared/types";

const isLoading = ref(false);

// AI : Module-level state shared across composable instances and standalone functions
// AI : loadedCityIds is now imported from useCityDataLoader to be shared with navigation
// AI : Track last zoom level to detect marker ↔ overlay transitions
const lastZoomLevel = ref<number | null>(null);

/**
 * AI : Main viewport content manager
 * AI : Handles all overlay and project rendering based on viewport bounds
 */
export function useViewportContentManager() {
  const overlayStore = useOverlayStore();

  /**
   * AI : Clear content for non-active cities while preserving active city markers
   * AI : Always removes overlay images (too cluttered when zoomed out)
   * AI : Keeps markers for active city to show locations
   */
  function clearContentExceptActiveCity(activeCityId: number, isEditMode: boolean) {
    // AI : Clear overlay images for ALL, markers for non-active cities only
    for (const [overlayId, overlay] of Object.entries(overlayStore.overlays)) {
      const belongsToActiveCity = overlay.project?.cityId === activeCityId;
      const isLocal = isEditMode && (overlay.status === null || overlay.status === undefined);

      // AI : Always remove overlay images when zoomed out
      if (overlay.overlay) {
        overlay.overlay.remove();
        overlayStore.updateOverlay(overlayId, { overlay: null });
      }

      // AI : Remove markers only for non-active cities
      if (!belongsToActiveCity && !isLocal && overlay.marker) {
        overlay.marker.remove();
        overlayStore.updateOverlay(overlayId, { marker: null });
      }
    }

    // AI : Clear standalone markers for non-active cities
    const projectStore = useProjectStore();
    const markerMap = getStandaloneProjectMarkerMap();

    for (const [projectId, marker] of markerMap.entries()) {
      const project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId];
      if (project && project.cityId !== activeCityId) {
        marker.remove();
        markerMap.delete(projectId);
      }
    }

    // AI : Remove non-active cities from loaded set
    for (const cityId of loadedCityIds.value) {
      if (cityId !== activeCityId) {
        loadedCityIds.value.delete(cityId);
      }
    }
  }

  /**
   * AI : Get visible cities in current viewport
   */
  function getVisibleCitiesInViewport(): typeof citiesWithProjects.value {
    if (!map.value) return [];

    const bounds = map.value.getBounds();
    return citiesWithProjects.value.filter((city) => bounds.contains([city.lat, city.lng]));
  }

  /**
   * AI : Re-render all loaded cities (used for zoom threshold changes)
   */
  async function reRenderLoadedCities() {
    if (loadedCityIds.value.size === 0) return;

    const overlayStore = useOverlayStore();
    const mapStore = useMapStore();

    // AI : Ensure all cities have data loaded
    for (const cityId of loadedCityIds.value) {
      // AI : OPTIMIZATION: Check if we have cached data for this city
      const cachedData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);

      if (!cachedData) {
        const city = citiesWithProjects.value.find((c) => c.id === cityId);
        if (city) {
          // AI : Load data (this puts it in cache)
          // AI : NOTE: loadCityData internally calls renderAllLoadedOverlays, so this might trigger multiple renders
          // AI : But since we're awaiting, it's safer.
          // AI : Ideally, loadCityData should have a 'noRender' flag, but for now this is fine.
          await loadCityData(cityId, city.name, city.nameLocal, city.countryCode);
        }
      }
    }

    // AI : RENDER all cities together based on zoom level
    const zoom = map.value?.getZoom() ?? 0;
    if (zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
      renderAllLoadedOverlays(true);
    } else {
      renderAllLoadedOverlays(false);
    }
  }

  /**
   * AI : Load all data for a single city
   */
  async function loadCityData(
    cityId: number,
    _cityName: string,
    _nameLocal: string | null,
    _countryCode: string,
    shouldRender = true,
  ) {
    const overlayStore = useOverlayStore();
    const mapStore = useMapStore();
    const mode = overlayStore.mode;

    try {
      // AI : OPTIMIZATION: Check MapStore cache first before querying backend
      let overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, mode);

      if (!overlaysData) {
        // AI : No cache - fetch from backend
        overlaysData = await trpc.cities.getCityOverlaysAndProjects.query({
          cityId,
          mode,
        });

        // AI : Cache the data for future use
        if (overlaysData) {
          mapStore.setCityProjectsCache(cityId, mode, overlaysData);
        }
      }

      // AI : CRITICAL: Always mark city as loaded, even if empty!
      loadedCityIds.value.add(cityId);

      // AI : Add standalone project markers BEFORE checking if overlays exist
      // AI : This ensures markers are created even for cities with ONLY standalone projects
      await addStandaloneMarkersForCity(overlaysData ?? [], cityId, mode);

      if (!overlaysData || overlaysData.length === 0) {
        return;
      }

      // AI : Guard against race condition: if mode changed while fetching, don't render stale data.
      // AI : The new mode's fetch (triggered by watcher) will handle rendering.
      if (overlayStore.mode !== mode) {
        return;
      }

      if (shouldRender) {
        const zoom = map.value?.getZoom() ?? 0;

        // AI : RENDER based on zoom level
        if (zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
          // AI : CRITICAL FIX: Render ALL loaded cities, not just the one we just fetched
          // AI : This prevents "fighting" between nearby cities where loading one clears the other
          renderAllLoadedOverlays();
        } else {
          // AI : For markers, we also need to be careful, but markers are handled differently (additive)
          // AI : However, renderMarkersOnly also clears everything first.
          // AI : So we should also aggregate for markers.
          renderAllLoadedOverlays(false);
        }
      }

      // AI : Update caches for Current Location Panel (already done above, but keeping for consistency)
      updateMapStoreCaches(overlaysData, [], mode);
    } catch (error) {
      console.error(`Error loading city ${cityId}:`, error);
      // AI : Even on error, mark as loaded to prevent infinite retries
      loadedCityIds.value.add(cityId);
    }
  }

  /**
   * AI : Helper to gather all overlays from all currently loaded cities
   * AI : and render them together. This ensures multi-city view works correctly.
   */
  function renderAllLoadedOverlays(fullRender = true) {
    const overlayStore = useOverlayStore();
    const mapStore = useMapStore();
    const mode = overlayStore.mode;

    let allOverlays: OverlayData[] = [];

    for (const cityId of loadedCityIds.value) {
      const cityData = mapStore.getCityOverlaysAndProjectsCache(cityId, mode);
      if (cityData) {
        allOverlays = allOverlays.concat(cityData);
      }
    }

    if (fullRender) {
      renderFullOverlays(allOverlays);
    } else {
      renderMarkersOnly(allOverlays);
    }
  }

  /**
   * AI : Main viewport refresh - CITY-BASED loading
   * AI : Only loads NEW cities that enter viewport
   */
  async function refreshViewport(force = false) {
    try {
      if (isLoading.value && !force) {
        return;
      }
      if (!map.value) {
        return;
      }

      const zoom = map.value.getZoom();

      // AI : Always prune entities based on new viewport
      // AI : This ensures city markers (which are visible at low zoom) are correctly added/removed
      // AI : and that overlays re-appear when zooming out and back in
      pruneMapEntities();

      // AI : CRITICAL: Don't load data until zoomed in past threshold
      if (zoom < MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD) {
        const isEditMode = overlayStore.mode === "edit";
        const mapStore = useMapStore();
        const activeCityId = mapStore.selectedCity?.id;

        // AI : Active city preservation: if a city is selected, keep its content loaded
        // AI : This allows users to zoom out to see both remote projects and city content
        if (activeCityId && loadedCityIds.value.has(activeCityId)) {
          clearContentExceptActiveCity(activeCityId, isEditMode);
        } else {
          // AI : No active city, clear everything as before
          clearAllOverlays(isEditMode);
          removeOverlayMarkers();
          clearAllStandaloneProjectMarkers();
          loadedCityIds.value.clear();
        }

        lastZoomLevel.value = zoom;
        return;
      }

      // AI : Check if we crossed the marker ↔ overlay threshold
      const previousZoom = lastZoomLevel.value;
      const crossedThreshold =
        previousZoom !== null &&
        ((previousZoom < MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS &&
          zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) ||
          (previousZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS &&
            zoom < MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS));

      lastZoomLevel.value = zoom;

      if (crossedThreshold) {
        await reRenderLoadedCities();
        // AI : Continue execution to load new cities if needed
      }

      // AI : Get cities visible in viewport
      const visibleCities = getVisibleCitiesInViewport();

      if (visibleCities.length === 0) {
        return;
      }

      // AI : Filter to only NEW cities we haven't loaded yet
      const newCities = force
        ? visibleCities
        : visibleCities.filter((city) => !loadedCityIds.value.has(city.id));

      if (newCities.length === 0) {
        return;
      }

      isLoading.value = true;

      // AI : Load each new city (entire city data, not just viewport slice)
      // AI : Pass false for shouldRender to batch updates and avoid flickering
      for (const city of newCities) {
        await loadCityData(city.id, city.name, city.nameLocal, city.countryCode, false);
      }

      // AI : After loading all new cities, trigger a single render
      // AI : This ensures we show all cities together without fighting/flickering
      const currentZoom = map.value.getZoom();
      if (currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        renderAllLoadedOverlays(true);
      } else {
        renderAllLoadedOverlays(false);
      }
    } catch (error) {
      console.error("Error refreshing viewport:", error);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * AI : Update MapStore caches for panels
   * AI : Groups flat viewport data by city so panels can query by city ID
   */
  function updateMapStoreCaches(overlays: OverlayData[], standaloneProjects: any[], mode: AppMode) {
    const mapStore = useMapStore();

    // AI : Group overlays by city
    const overlaysByCity = new Map<number, OverlayData[]>();
    for (const overlay of overlays) {
      // AI : Backend returns full city object in 'city' field or cityId in project
      const cityId = overlay.project?.cityId;
      if (cityId) {
        const list = overlaysByCity.get(cityId) ?? [];
        list.push(overlay);
        overlaysByCity.set(cityId, list);
      }
    }

    // AI : Update city projects cache
    for (const [cityId, data] of overlaysByCity.entries()) {
      mapStore.setCityProjectsCache(cityId, mode, data);
    }

    // AI : Group standalone projects by city
    const standaloneByCity = new Map<number, any[]>();
    for (const project of standaloneProjects) {
      const cityId = project.cityId;
      if (cityId) {
        const list = standaloneByCity.get(cityId) ?? [];
        list.push(project);
        standaloneByCity.set(cityId, list);
      }
    }

    // AI : Update standalone cache
    for (const [cityId, data] of standaloneByCity.entries()) {
      mapStore.setCityStandaloneProjectsCache(cityId, mode, data);
    }
  }

  async function addStandaloneMarkersForCity(
    overlaysData: OverlayData[],
    cityId: number,
    mode: AppMode,
  ) {
    try {
      // AI : OPTIMIZATION: Check cache first before querying backend
      // AI : Use shared function to avoid code duplication
      const allProjects = await fetchCityStandaloneProjectsOrCache(cityId, mode);

      // AI : Create a working copy to avoid mutating cache
      const projectsToRender: StandaloneProject[] = allProjects ? [...allProjects] : [];

      // AI : In edit mode, include local pending projects from store
      // AI : In edit mode, include local pending projects from store
      if (mode === "edit") {
        const projectStore = useProjectStore();
        const localProjects = Object.values(projectStore.projects).filter(
          (p) => p.city?.id === cityId && (p.status === null || p.status === undefined),
        );

        for (const localP of localProjects) {
          // AI : Check if project is already explicitly in the list
          if (!projectsToRender.find((p) => p.id === localP.id)) {
            // AI : Type-safe push thanks to StandaloneProject union type
            projectsToRender.push(localP);
          }
        }
      }

      if (projectsToRender.length === 0) return;

      // AI : Get project IDs that have overlays
      const projectIdsWithOverlays = new Set<string>();
      for (const overlay of overlaysData) {
        if (overlay.projectId) {
          projectIdsWithOverlays.add(overlay.projectId);
        }
      }

      // AI : Create standalone markers for projects without any visible overlays
      for (const project of projectsToRender) {
        // AI : Type narrowing for different overlay count properties
        let overlayCount = 0;
        if ("overlayCount" in project) {
          overlayCount = project.overlayCount;
        } else if ("overlayIds" in project && Array.isArray(project.overlayIds)) {
          overlayCount = project.overlayIds.length;
        } else if ("overlays" in project && Array.isArray(project.overlays)) {
          overlayCount = project.overlays.length;
        }

        if (!projectIdsWithOverlays.has(project.id) && overlayCount === 0) {
          addStandaloneProjectMarkerForProject(createProjectObject(toProjectPartial(project)));
        }
      }
    } catch (error) {
      console.error(`Error adding standalone markers for city ${cityId}:`, error);
    }
  }

  /**
   * AI : Render full overlay images (high zoom)
   */
  function renderFullOverlays(overlaysData: OverlayData[]) {
    // AI : Remove low-zoom markers
    removeOverlayMarkers();

    // AI : Store UNFILTERED data - filtering happens in pruneOverlays at render time
    // AI : This ensures overlays can be recreated when filters are toggled back on
    overlayStore.setViewModeOverlays(overlaysData);

    // AI : CRITICAL: Update mapStore for panels
    // AI : Panels (like Current Location) read from mapStore.currentCityOverlays
    const mapStore = useMapStore();
    mapStore.currentCityOverlays = overlaysData;

    // AI : Update existing overlay objects with fresh backend data
    // AI : This is critical for mode switches (e.g., view → moderation) where overlays
    // AI : are already loaded but need updated data like suggestedCorners for change requests
    // AI : OPTIMIZATION: Use batch update to prevent O(N^2) state spreading
    const updates: Record<string, Partial<OverlayData>> = {};

    for (const overlayData of overlaysData) {
      if (overlayStore.overlays[overlayData.id]) {
        updates[overlayData.id] = {
          hasPendingChanges: overlayData.hasPendingChanges,
          suggestedCorners: overlayData.suggestedCorners,
          pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
          // AI : Don't update corners/centroid as those are the approved positions
          // AI : and shouldn't change when switching modes
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      overlayStore.batchUpdateOverlays(updates);
    }

    // AI : Render overlays
    // AI : DELEGATE TO PRUNING SERVICE
    // AI : Instead of rendering loop here (which renders everything),
    // AI : defer to pruneMapEntities which checks visibility bounds first.
    // AI : This prevents network requests for off-screen images.
    pruneMapEntities();
  }

  /**
   * AI : Render overlay markers only (low zoom)
   */
  function renderMarkersOnly(overlaysData: OverlayData[]) {
    // AI : In edit mode, preserve overlay store data so local overlays can be restored when zooming back in
    // AI : In view mode, clear everything since local overlays shouldn't be visible anyway
    const isEditMode = overlayStore.mode === "edit";
    clearAllOverlays(isEditMode);

    // AI : Collect all overlays to render as markers
    const allOverlaysForMarkers = [...overlaysData];

    // AI : In edit mode, also include preserved overlays from the store that aren't in overlaysData
    // AI : This includes local-only overlays AND backend overlays from other cities that were preserved
    if (isEditMode) {
      const overlayDataIds = new Set(overlaysData.map((o) => o.id));
      for (const [id, existing] of Object.entries(overlayStore.overlays)) {
        // AI : Skip if already in backend data
        if (overlayDataIds.has(id)) continue;

        // AI : In view mode we'd skip local overlays, but we're already in isEditMode check
        allOverlaysForMarkers.push({
          id: existing.id,
          version: existing.version,
          filename: existing.filename,
          caption: existing.caption,
          status: existing.status,
          projectId: existing.projectId,
          authorId: existing.authorId,
          replacesOverlayId: existing.replacesOverlayId,
          replacedByOverlayId: existing.replacedByOverlayId,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
          centroid: existing.centroid,
          corners: existing.corners,
          isModified: existing.isModified,
        });
      }
    }

    // AI : Render markers
    renderOverlayMarkersFromData(allOverlaysForMarkers);
  }

  /**
   * AI : Debounced viewport change handler
   * AI : 100ms is fast enough for good UX while still preventing duplicate calls during pan
   */
  const debouncedRefreshViewport = debounce(refreshViewport, 100);

  function setupEventListeners() {
    if (!map.value) return;

    // AI : Use debounced handler for BOTH moveend and zoomend
    // AI : This prevents duplicate calls when flyTo triggers both events
    // AI : Wrap in arrow function to satisfy TypeScript event handler typing
    map.value.on("moveend", () => debouncedRefreshViewport());
    map.value.on("zoomend", () => debouncedRefreshViewport());
  }

  /**
   * AI : Cleanup event listeners
   */
  function cleanupEventListeners() {
    if (!map.value) return;

    // AI : Remove all moveend and zoomend listeners
    map.value.off("moveend");
    map.value.off("zoomend");
  }

  /**
   * AI : Setup mode change watcher
   * AI : When mode changes, clear loaded cities cache and reload visible cities
   */
  function setupModeWatcher() {
    watch(
      () => overlayStore.mode,
      async (newMode, oldMode) => {
        // AI : Guard: only reload if mode actually changed
        if (newMode === oldMode) {
          return;
        }

        // AI : Clear all standalone project markers on mode switch
        // AI : They might be invalid in the new mode (e.g., local projects in view mode) as they are not store-managed
        clearAllStandaloneProjectMarkers();

        // AI : CRITICAL: Save any modified overlays before we potentially hide them
        // AI : If we are leaving edit mode, we must save the current state to cache
        // AI : This prevents data loss for user's pending overlays that disappear in View mode
        if (oldMode === "edit") {
          saveAllOverlaysToCache();
        }

        // AI : CRITICAL: Different modes return different data from backend
        // AI : - View mode: Only approved content
        // AI : - Edit mode: Approved + user's own pending
        // AI : - Moderation mode: Approved + all users' pending
        // AI : So we need to reload when switching between ANY modes to get correct data
        const isModerationTransition = oldMode === "moderation" || newMode === "moderation";
        const hasLoadedOverlays = Object.keys(overlayStore.overlays).length > 0;
        const hasLoadedContent = loadedCityIds.value.size > 0;

        // AI : CRITICAL: When switching modes, hide overlays that shouldn't be visible in the new mode
        // AI : We unmount them (remove from map) but keep in store so they can reappear when switching modes
        if (hasLoadedOverlays) {
          const updates: Record<string, Partial<OverlayObject>> = {};
          const markersToRemove: string[] = [];
          const authStore = useAuthStore();
          const currentUserId = authStore.user?.id;

          for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
            // AI : Determine if overlay should be hidden based on new mode //
            const shouldHide = !isOverlayVisible(overlay, newMode, currentUserId);

            if (shouldHide) {
              if (overlay.overlay) overlay.overlay.remove();
              if (overlay.marker) overlay.marker.remove();

              // AI : Queue update instead of triggering reactivity immediately
              updates[id] = { overlay: null, marker: null };

              // AI : CRITICAL: Clear from allMarkers cache so it can be recreated when switching back
              markersToRemove.push(id);
            }
          }

          // AI : Execute batch updates (O(1) reactivity trigger)
          if (Object.keys(updates).length > 0) {
            overlayStore.batchUpdateOverlays(updates);
          }

          // AI : Batch clear markers
          if (markersToRemove.length > 0) {
            overlayStore.clearMarkersFromCache(markersToRemove);
          }
        }

        // AI : Always reload when involving moderation mode or when we have content loaded
        if (isModerationTransition || hasLoadedOverlays || hasLoadedContent) {
          // AI : Don't clear overlays immediately - let them stay visible while loading
          // AI : CRITICAL: Do NOT clear loadedCityIds here. Instead, reload all currently loaded cities.
          // AI : This ensures that cities whose center is off-screen (but whose overlays are visible) are correctly updated.
          // AI : If we just cleared cache and relied on refreshViewport, it would only load cities with visible centers.
          const currentCityIds = [...loadedCityIds.value];

          await Promise.all(
            currentCityIds.map(async (id) => loadCityData(id, "reload", null, "reload")),
          );

          // AI : Update existing overlays in-place with new toolbar actions and positions
          // AI : MOVED HERE (after reload) to ensure we operate on fresh data
          // AI : This preserves edit mode cache and updates marker colors after modifications
          updateOverlayEditingState();

          // AI : CRITICAL FIX: After reloading, explicitly create standalone markers for local projects
          // AI : This ensures markers appear immediately without requiring user to click city or zoom
          if (newMode === "edit") {
            const projectStore = useProjectStore();
            const authStore = useAuthStore();

            // AI : Include both local (unsaved) and user's pending projects
            const userProjects = Object.values(projectStore.projects).filter((p) => {
              if (!p.lat || !p.lng) return false;

              // AI : Local projects (not yet submitted)
              if (p.status === null || p.status === undefined) return true;

              // AI : User's own pending projects (submitted but not approved)
              if (p.status === "pending" && authStore.user && p.ownerId === authStore.user.id)
                return true;

              return false;
            });

            for (const project of userProjects) {
              addStandaloneProjectMarkerForProject(project);
            }
          }
        }
      },
    );
  }

  return {
    refreshViewport,
    reRenderLoadedCities,
    setupEventListeners,
    cleanupEventListeners,
    setupModeWatcher,
    isLoading,
  };
}

// AI : Navigation loading functions moved to useCityDataLoader.ts to break circular dependency

// AI : Accept HMR updates for this module
if (import.meta.hot) {
  import.meta.hot.accept();
}
