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
import { renderViewModeOverlays } from "@/services/overlay/overlayRendering";
import { updateOverlayEditingState } from "@/services/overlay/overlayEditing";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { updateOverlayMarkersColors } from "@/services/map/markers";
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
import type { OverlayData } from "@/types/index";
import {
  createProjectObject,
  toProjectPartial,
  type StandaloneProject,
} from "@/utils/typeFactories";
import type { MapMode } from "@shared/types";

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
   * AI : Update overlay marker colors when mode changes
   * AI : Changes from Timeline Status (view) to Approval Status (edit)
   */
  function updateMarkerColorsForMode() {
    updateOverlayMarkersColors(ref(overlayStore.overlays), overlayStore.mode);
  }

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
    const currentZoom = map.value?.getZoom() ?? 0;

    // AI : Reload all cities that are currently loaded
    for (const cityId of loadedCityIds.value) {
      // AI : OPTIMIZATION: Check if we have cached data for this city
      // AI : If we do, just re-render from cache instead of fetching from backend
      const cachedData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);

      if (cachedData) {
        if (cachedData.length === 0) {
          continue;
        }

        // AI : RENDER based on zoom level
        if (currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
          renderFullOverlays(cachedData);
        } else {
          renderMarkersOnly(cachedData);
        }
      } else {
        const city = citiesWithProjects.value.find((c) => c.id === cityId);
        if (city) {
          await loadCityData(cityId, city.name, city.nameLocal, city.countryCode);
        }
      }
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

      const zoom = map.value?.getZoom() ?? 0;

      // AI : RENDER based on zoom level
      if (zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        renderFullOverlays(overlaysData);
      } else {
        renderMarkersOnly(overlaysData);
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
      for (const city of newCities) {
        await loadCityData(city.id, city.name, city.nameLocal, city.countryCode);
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
  function updateMapStoreCaches(overlays: OverlayData[], standaloneProjects: any[], mode: MapMode) {
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
    mode: MapMode,
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

    // AI : Update store
    overlayStore.setViewModeOverlays(overlaysData);

    // AI : CRITICAL: Update mapStore for panels
    // AI : Panels (like Current Location) read from mapStore.currentCityOverlays
    const mapStore = useMapStore();
    mapStore.currentCityOverlays = overlaysData;

    // AI : Update existing overlay objects with fresh backend data
    // AI : This is critical for mode switches (e.g., view → moderation) where overlays
    // AI : are already loaded but need updated data like suggestedCorners for change requests
    for (const overlayData of overlaysData) {
      const existing = overlayStore.overlays[overlayData.id];
      if (existing) {
        overlayStore.updateOverlay(overlayData.id, {
          hasPendingChanges: overlayData.hasPendingChanges,
          suggestedCorners: overlayData.suggestedCorners,
          pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
          // AI : Don't update corners/centroid as those are the approved positions
          // AI : and shouldn't change when switching modes
        });
      }
    }

    // AI : Render overlays
    const existingOverlays = overlayStore.overlays;
    const existingIds = new Set(Object.keys(existingOverlays));
    const hasExisting = existingIds.size > 0;

    if (!hasExisting) {
      // AI : Initial render
      renderViewModeOverlays(overlaysData, true, false);
    } else {
      // AI : Update/add overlays without removing existing ones
      // AI : Don't remove overlays not in overlaysData - they may be from other cities
      // AI : Overlays are only removed via clearAllOverlays on mode switch/zoom out

      // AI : Find overlays that need rendering:
      // AI : 1. New overlays not in store
      // AI : 2. Existing overlays in overlaysData with null Leaflet layer
      const overlayDataIds = new Set(overlaysData.map((o) => o.id));
      const overlaysToRender = overlaysData.filter((o) => {
        if (!existingIds.has(o.id)) return true; // New overlay
        const existing = existingOverlays[o.id];
        return existing && existing.overlay === null; // Needs re-rendering
      });

      // AI : CRITICAL: Also re-render existing overlays with null layers that are NOT in overlaysData
      // AI : This handles overlays from other cities that were preserved during zoom out
      // AI : In edit mode, also include local overlays (status === null)
      for (const [id, existing] of Object.entries(existingOverlays)) {
        if (existing.overlay === null && !overlayDataIds.has(id)) {
          // AI : Skip if already in overlaysToRender
          if (overlaysToRender.some((o) => o.id === id)) continue;

          // AI : Skip overlays that shouldn't be visible in current mode
          const mode = overlayStore.mode;
          let shouldSkip = false;

          if (mode === "view") {
            // AI : View mode: Only render approved overlays
            shouldSkip = existing.status !== "approved";
          } else if (mode === "moderation") {
            // AI : Moderation mode: Render approved + pending, skip local-only and rejected
            shouldSkip =
              existing.status === null ||
              existing.status === undefined ||
              existing.status === "rejected";
          } else if (mode === "edit") {
            // AI : Edit mode: Skip rejected (backend handles filtering for user's own pending)
            shouldSkip = existing.status === "rejected";
          }

          if (shouldSkip) {
            continue;
          }

          // AI : Convert existing overlay to OverlayData format for rendering
          // AI : Use filename (not imageUrl) - imageUrl has the full URL path that gets duplicated by createOverlayFromCDN
          overlaysToRender.push({
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

      if (overlaysToRender.length > 0) {
        renderViewModeOverlays(overlaysToRender, true, false);
      }
    }
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
    let allOverlaysForMarkers = [...overlaysData];

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

        // AI : Update existing overlay marker colors (Timeline vs Approval status)
        updateMarkerColorsForMode();

        // AI : Update existing overlays in-place with new toolbar actions and positions
        // AI : This preserves edit mode cache and updates marker colors after modifications
        updateOverlayEditingState();

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
          for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
            let shouldHide = false;

            // AI : Determine if overlay should be hidden based on new mode
            if (newMode === "view") {
              // AI : View mode: Only show approved overlays
              // AI : Hide: local-only (null/undefined), pending, rejected
              shouldHide = overlay.status !== "approved";
            } else if (newMode === "moderation") {
              // AI : Moderation mode: Show approved + pending from all users
              // AI : Hide: local-only (null/undefined), rejected
              shouldHide =
                overlay.status === null ||
                overlay.status === undefined ||
                overlay.status === "rejected";
            } else if (newMode === "edit") {
              // AI : Edit mode: Show approved + user's own pending
              // AI : Hide: rejected, other users' pending (backend reload will handle this correctly)
              // AI : For now, hide rejected overlays. Backend reload will provide correct data.
              shouldHide = overlay.status === "rejected";
            }

            if (shouldHide) {
              if (overlay.overlay) overlay.overlay.remove();
              if (overlay.marker) overlay.marker.remove();
              overlayStore.updateOverlay(id, { overlay: null, marker: null });
              // AI : CRITICAL: Clear from allMarkers cache so it can be recreated when switching back
              delete overlayStore.allMarkers[id];
            }
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

          await refreshViewport(true);

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
    setupEventListeners,
    cleanupEventListeners,
    setupModeWatcher,
    isLoading,
  };
}

// AI : Navigation loading functions moved to useCityDataLoader.ts to break circular dependency
