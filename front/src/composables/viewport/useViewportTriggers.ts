// Viewport-based content manager - replaces city-based loading with spatial queries
// Single rendering path for all triggers (pan, zoom, mode switch, navigation)
import { ref, watch } from "vue";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useAuthStore } from "@/stores/authStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import { citiesWithProjects } from "@/services/map/cityMarkers";
import {
  addStandaloneProjectMarkerForProject,
  clearAllStandaloneProjectMarkers,
  getStandaloneProjectMarkerMap,
} from "@/services/map/standaloneProjectMarkers";
import {
  loadedCityIds,
  fetchCityStandaloneProjectsOrCache,
  fetchCityOverlaysOrCache,
} from "@/services/navigation/cityDataLoader";
import {
  processStandaloneMarkers,
  renderFullOverlays,
  hydrateOverlayStoreObjects,
} from "@/services/navigation/cityRenderingCore";
import { filterByStatus } from "@/services/overlay/statusFilters";
import type { OverlayData } from "@/types/index";
import { type StandaloneProject } from "@/utils/typeFactories";
import type { AppMode } from "@shared/types";

const isLoading = ref(false);

// Module-level state shared across composable instances and standalone functions
// Track last zoom level to detect marker ↔ overlay transitions
const lastZoomLevel = ref<number | null>(null);

/**
 * Main viewport content manager
 * Handles all overlay and project rendering based on viewport bounds
 */
export function useViewportTriggers() {
  // Initialize all stores at root level for better performance and cleaner code
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  /**
   * Clear content for non-active cities while preserving active city markers
   * Always removes overlay images (too cluttered when zoomed out)
   * Keeps markers for active city to show locations
   */
  function clearContentExceptActiveCity(activeCityId: number, isEditMode: boolean) {
    // Clear overlay images for ALL, markers for non-active cities only
    for (const [overlayId, overlay] of Object.entries(overlayStore.overlays)) {
      const belongsToActiveCity = overlay.project?.cityId === activeCityId;
      const isLocal = isEditMode && overlay.status === null;

      // Always remove overlay images when zoomed out
      registry.removeLayerFromMap(overlayId);

      // Remove markers only for non-active cities
      if (!belongsToActiveCity && !isLocal) {
        registry.removeMarkerFromMap(overlayId);
      }
    }

    // Clear standalone markers for non-active cities
    const markerMap = getStandaloneProjectMarkerMap();

    for (const [projectId, marker] of markerMap.entries()) {
      const project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId];
      if (project && project.cityId !== activeCityId) {
        marker.remove();
        markerMap.delete(projectId);
      }
    }

    // Remove non-active cities from loaded set
    for (const cityId of loadedCityIds.value) {
      if (cityId !== activeCityId) {
        loadedCityIds.value.delete(cityId);
      }
    }
  }

  /**
   * Get visible cities in current viewport
   */
  function getVisibleCitiesInViewport(): typeof citiesWithProjects.value {
    const bounds = map.value.getBounds();
    const visible = citiesWithProjects.value.filter((city) =>
      bounds.contains([city.lat, city.lng]),
    );

    // Fallback: when zoomed in far enough that no city marker is in the viewport
    // (e.g. viewing a contribution far from the city center, or loading a shared URL),
    // find the nearest city so its data still gets loaded.
    if (visible.length === 0 && citiesWithProjects.value.length > 0) {
      const center = map.value.getCenter();
      let nearest = citiesWithProjects.value[0]!;
      let minDist = Infinity;
      for (const city of citiesWithProjects.value) {
        const dLat = city.lat - center.lat;
        const dLng = city.lng - center.lng;
        const dist = dLat * dLat + dLng * dLng;
        if (dist < minDist) {
          minDist = dist;
          nearest = city;
        }
      }
      return [nearest];
    }

    return visible;
  }

  /**
   * Re-render all loaded cities (used for zoom threshold changes)
   */
  async function reRenderLoadedCities() {
    if (loadedCityIds.value.size === 0) return;

    // Ensure all cities have data loaded
    for (const cityId of loadedCityIds.value) {
      // OPTIMIZATION: Check if we have cached data for this city
      const cachedData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);

      if (!cachedData) {
        const city = citiesWithProjects.value.find((c) => c.id === cityId);
        if (city) {
          // Load data (this puts it in cache)
          // NOTE: loadCityData internally calls renderAllLoadedOverlays, so this might trigger multiple renders
          // But since we're awaiting, it's safer.
          // Ideally, loadCityData should have a 'noRender' flag, but for now this is fine.
          await loadCityData(cityId, city.name, city.nameLocal, city.countryCode);
        }
      }
    }

    // RENDER all cities together based on zoom level
    const zoom = map.value.getZoom();
    if (zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS)) {
      renderAllLoadedOverlays(true);
    } else {
      renderAllLoadedOverlays(false);
    }
  }

  /**
   * Load all data for a single city
   */
  async function loadCityData(
    cityId: number,
    _cityName: string,
    _nameLocal: string | null,
    _countryCode: string,
    shouldRender = true,
  ) {
    const mode = overlayStore.mode;

    try {
      const overlaysData = await fetchCityOverlaysOrCache(cityId, mode);

      // CRITICAL: Always mark city as loaded, even if empty!
      loadedCityIds.value.add(cityId);

      // Add standalone project markers BEFORE checking if overlays exist
      // This ensures markers are created even for cities with ONLY standalone projects
      await addStandaloneMarkersForCity(overlaysData ?? [], cityId, mode);

      if (!overlaysData || overlaysData.length === 0) {
        return;
      }

      // Guard against race condition: if mode changed while fetching, don't render stale data.
      // The new mode's fetch (triggered by watcher) will handle rendering.
      if (overlayStore.mode !== mode) {
        return;
      }

      if (shouldRender) {
        const zoom = map.value.getZoom();

        // RENDER based on zoom level
        if (zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS)) {
          // CRITICAL FIX: Render ALL loaded cities, not just the one we just fetched
          // This prevents "fighting" between nearby cities where loading one clears the other
          renderAllLoadedOverlays();
        } else {
          // For markers, we also need to be careful, but markers are handled differently (additive)
          // However, renderMarkersOnly also clears everything first.
          // So we should also aggregate for markers.
          renderAllLoadedOverlays(false);
        }
      }
    } catch (error) {
      console.error(`Error loading city ${cityId}:`, error);
      // Even on error, mark as loaded to prevent infinite retries
      loadedCityIds.value.add(cityId);
    }
  }

  /**
   * Helper to gather all overlays from all currently loaded cities
   * and render them together. This ensures multi-city view works correctly.
   */
  function renderAllLoadedOverlays(fullRender = true) {
    const mode = overlayStore.mode;

    const allOverlays: OverlayData[] = [];

    for (const cityId of loadedCityIds.value) {
      const cityData = mapStore.getCityOverlaysAndProjectsCache(cityId, mode);
      if (cityData) {
        allOverlays.push(...cityData);
      }
    }

    if (fullRender) {
      renderFullOverlays(allOverlays);
    } else {
      renderMarkersOnly(allOverlays);
    }
  }

  /**
   * Main viewport refresh - CITY-BASED loading
   * Only loads NEW cities that enter viewport
   */
  async function refreshViewport(force = false) {
    try {
      if (isLoading.value && !force) {
        return;
      }

      const zoom = map.value.getZoom();
      const previousZoom = lastZoomLevel.value;
      const loadThreshold = getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD);
      const overlayThreshold = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

      // Detect low→high threshold crossing before pruning.
      // When crossing this boundary, renderFullOverlays() will call runViewportRenderLoop()
      // after removing the dot markers (overlayMarkersLayer). Calling it here first
      // queues async store-managed marker creation before dot markers are removed,
      // causing a visual glitch where markers appear to re-appear during zoom.
      const crossedLowToHigh =
        zoom >= loadThreshold &&
        previousZoom !== null &&
        previousZoom < overlayThreshold &&
        zoom >= overlayThreshold;

      // Prune entities (city markers, overlay visibility).
      // Skipped when crossing low→high: renderFullOverlays handles pruning after cleanup.
      if (!crossedLowToHigh) {
        runViewportRenderLoop();
      }

      // CRITICAL: Don't load data until zoomed in past threshold
      if (zoom < loadThreshold) {
        const isEditMode = overlayStore.mode === "edit";
        const activeCityId = mapStore.selectedCity?.id;

        // Active city preservation: if a city is selected, keep its content loaded
        // This allows users to zoom out to see both remote projects and city content
        if (activeCityId && loadedCityIds.value.has(activeCityId)) {
          clearContentExceptActiveCity(activeCityId, isEditMode);
        } else {
          // No active city, clear everything as before
          clearAllOverlays(isEditMode);
          clearAllStandaloneProjectMarkers();
          loadedCityIds.value.clear();
        }

        lastZoomLevel.value = zoom;
        return;
      }

      // Check if we crossed the marker ↔ overlay threshold
      const crossedThreshold =
        previousZoom !== null &&
        ((previousZoom < overlayThreshold && zoom >= overlayThreshold) ||
          (previousZoom >= overlayThreshold && zoom < overlayThreshold));

      lastZoomLevel.value = zoom;

      if (crossedThreshold) {
        await reRenderLoadedCities();
        // Continue execution to load new cities if needed
      }

      // Get cities visible in viewport
      const visibleCities = getVisibleCitiesInViewport();

      if (visibleCities.length === 0) {
        return;
      }

      // Filter to only NEW cities we haven't loaded yet
      const newCities = force
        ? visibleCities
        : visibleCities.filter((city) => !loadedCityIds.value.has(city.id));

      if (newCities.length === 0) {
        return;
      }

      isLoading.value = true;

      // Load each new city (entire city data, not just viewport slice)
      // Pass false for shouldRender to batch updates and avoid flickering
      for (const city of newCities) {
        await loadCityData(city.id, city.name, city.nameLocal, city.countryCode, false);
      }

      // After loading all new cities, trigger a single render
      // This ensures we show all cities together without fighting/flickering
      const currentZoom = map.value.getZoom();
      if (currentZoom >= overlayThreshold) {
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

  async function addStandaloneMarkersForCity(
    overlaysData: OverlayData[],
    cityId: number,
    mode: AppMode,
  ) {
    try {
      // Check cache first before querying backend
      const allProjects = await fetchCityStandaloneProjectsOrCache(cityId, mode);

      // Create a working copy to avoid mutating cache
      const projectsToRender: StandaloneProject[] = allProjects ? [...allProjects] : [];

      // In edit mode, also include local (unsaved) pending projects from the store
      if (mode === "edit") {
        const localProjects = Object.values(projectStore.projects).filter(
          (p) => p.city.id === cityId && p.status === null,
        );

        for (const localP of localProjects) {
          if (!projectsToRender.find((p) => p.id === localP.id)) {
            projectsToRender.push(localP);
          }
        }
      }

      // Delegate marker creation to the shared rendering core
      processStandaloneMarkers(projectsToRender, overlaysData);
    } catch (error) {
      console.error(`Error adding standalone markers for city ${cityId}:`, error);
    }
  }

  // renderFullOverlays is imported from cityRenderingCore and called directly

  /**
   * Render overlay markers only (low zoom)
   */
  function renderMarkersOnly(overlaysData: OverlayData[]) {
    // Always preserve store data when crossing to marker-only zoom.
    // This keeps allMarkers intact and markers on the Leaflet map so that:
    //  - pruneOverlays can show them at zoom 13 via showMarkers=true
    //  - createSingleMarker's allMarkers guard fires on zoom-in, skipping recreation
    const isEditMode = overlayStore.mode === "edit";
    clearAllOverlays(true);

    // Collect all overlays to render as markers
    const allOverlaysForMarkers = [...overlaysData];

    // In edit mode, also include preserved overlays from the store that aren't in overlaysData
    // This includes local-only overlays AND backend overlays from other cities that were preserved
    if (isEditMode) {
      const overlayDataIds = new Set(overlaysData.map((o) => o.id));
      for (const [id, existing] of Object.entries(overlayStore.overlays)) {
        // Skip if already in backend data
        if (overlayDataIds.has(id)) continue;

        // In view mode we'd skip local overlays, but we're already in isEditMode check
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

    // Update the store with all required overlays for the markers
    overlayStore.setViewModeOverlays(allOverlaysForMarkers);

    // Sync batch updates for any fresh data
    hydrateOverlayStoreObjects(allOverlaysForMarkers);

    // Filter using OverlayData (which carries project info) so that getOverlayMarkerColor
    // can compute the correct timeline-based color in view mode.
    // Filtering overlayStore.overlays (OverlayObject) would yield wrong colors
    // because OverlayObjects in the store don't carry the embedded project.
    const visibleOverlayIds = new Set(
      filterByStatus(allOverlaysForMarkers, overlayStore.mode).map((o) => o.id),
    );

    // Render interactive markers only for completion-filter-passing overlays
    // createSingleMarker safely ignores markers that already exist
    for (const overlayObject of Object.values(overlayStore.overlays)) {
      if (visibleOverlayIds.has(overlayObject.id)) {
        createSingleMarker(overlayObject);
      }
    }
  }

  /**
   * Debounced viewport change handler
   * 100ms is fast enough for good UX while still preventing duplicate calls during pan
   */
  const debouncedRefreshViewport = debounce(refreshViewport, 100);

  function setupEventListeners() {
    // Use debounced handler for BOTH moveend and zoomend
    // This prevents duplicate calls when flyTo triggers both events
    // Wrap in arrow function to satisfy TypeScript event handler typing
    map.value.on("moveend", () => debouncedRefreshViewport());
    map.value.on("zoomend", () => debouncedRefreshViewport());
  }

  /**
   * Cleanup event listeners
   */
  function cleanupEventListeners() {
    // Remove all moveend and zoomend listeners
    map.value.off("moveend");
    map.value.off("zoomend");
  }

  /**
   * Setup mode change watcher
   * When mode changes, clear loaded cities cache and reload visible cities
   */
  function setupModeWatcher() {
    // When the cityMarkers mode watcher updates citiesWithProjects with edit/moderation-mode cities
    // (including cities that have ONLY pending content and were not in view-mode citiesWithProjects),
    // trigger a viewport refresh so those new cities get loaded without requiring camera movement.
    // This is the primary fix for: pending overlay/standalone marker invisible after page refresh + tab switch.
    watch(citiesWithProjects, async () => {
      // Only needed in non-view modes — view mode's initial refreshViewport handles it.
      if (overlayStore.mode === "view") return;
      // force=true: bypass the isLoading guard so it doesn't silently drop if a concurrent
      // refreshViewport is running. getCityOverlaysAndProjectsCache returns cached data for
      // already-loaded cities so this doesn't cause redundant network requests.
      await refreshViewport(true);
    });

    watch(
      () => overlayStore.mode,
      async (newMode, oldMode) => {
        // Guard: only reload if mode actually changed
        if (newMode === oldMode) {
          return;
        }

        // Clear all standalone project markers on mode switch
        // They might be invalid in the new mode (e.g., local projects in view mode) as they are not store-managed
        clearAllStandaloneProjectMarkers();

        // Single import for all overlayEditing symbols used in this watcher
        // Avoids two separate dynamic import() calls to the same module
        const { saveAllOverlaysToCache, updateOverlayEditingState, setupKeyboardShortcuts } =
          await import("@/services/overlay/overlayEditing");

        // CRITICAL: Save any modified overlays before we potentially hide them
        // If we are leaving edit mode, we must save the current state to cache
        // This prevents data loss for user's pending overlays that disappear in View mode
        if (oldMode === "edit") {
          saveAllOverlaysToCache("edit");
        }

        // CRITICAL: Different modes return different data from backend
        // - View mode: Only approved content
        // - Edit mode: Approved + user's own pending
        // - Moderation mode: Approved + all users' pending
        // So we need to reload when switching between ANY modes to get correct data
        const isModerationTransition = oldMode === "moderation" || newMode === "moderation";
        const hasLoadedOverlays = Object.keys(overlayStore.overlays).length > 0;
        const hasLoadedContent = loadedCityIds.value.size > 0;

        // CRITICAL: When switching modes, hide overlays that shouldn't be visible in the new mode
        // We unmount them (remove from map) but keep in store so they can reappear when switching modes
        if (hasLoadedOverlays) {
          const currentUserId = authStore.user?.id;

          for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
            const shouldHide = !isOverlayVisible(overlay, newMode, currentUserId);

            if (shouldHide) {
              // Remove layer and marker from map, clear from registry so they can
              // be recreated when switching back to a mode where they're visible.
              registry.clearEntry(id);
            }
          }
        }

        // Always reload when involving moderation mode or when we have content loaded
        if (isModerationTransition || hasLoadedOverlays || hasLoadedContent) {
          // Don't clear overlays immediately - let them stay visible while loading
          // CRITICAL: Do NOT clear loadedCityIds here. Instead, reload all currently loaded cities.
          // This ensures that cities whose center is off-screen (but whose overlays are visible) are correctly updated.
          // If we just cleared cache and relied on refreshViewport, it would only load cities with visible centers.
          const currentCityIds = [...loadedCityIds.value];

          await Promise.all(
            currentCityIds.map(async (id) => loadCityData(id, "reload", null, "reload")),
          );

          // Update existing overlays in-place with new toolbar actions and positions
          // MOVED HERE (after reload) to ensure we operate on fresh data
          // This preserves edit mode cache and updates marker colors after modifications
          await updateOverlayEditingState();
          setupKeyboardShortcuts();

          // CRITICAL FIX: After reloading, explicitly create standalone markers for local projects
          // This ensures markers appear immediately without requiring user to click city or zoom
          if (newMode === "edit") {
            // Include both local (unsaved) and user's pending projects
            const userProjects = Object.values(projectStore.projects).filter((p) => {
              if (!p.lat || !p.lng) return false;

              // Local projects (not yet submitted)
              if (p.status === null) return true;

              // User's own pending projects (submitted but not approved)
              if (p.status === "pending" && p.ownerId === authStore.user?.id) return true;

              return false;
            });

            for (const project of userProjects) {
              addStandaloneProjectMarkerForProject(project);
            }
          }
        } else {
          // Race condition: mode switched while the initial page-load fetch was still in-flight.
          // loadedCityIds is empty because loadCityData hasn't finished yet (it adds the city
          // only after the async fetch completes). The in-flight fetch will hit the race-condition
          // guard (overlayStore.mode !== captured mode) and return without rendering.
          // Force a fresh viewport refresh in the new mode so the correct content appears
          // without requiring the user to pan or zoom.
          await refreshViewport(true);

          // Still apply editing state and shortcuts even when no prior content was loaded
          await updateOverlayEditingState();
          setupKeyboardShortcuts();
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
