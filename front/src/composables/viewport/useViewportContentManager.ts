// AI : Viewport-based content manager - replaces city-based loading with spatial queries
// AI : Single rendering path for all triggers (pan, zoom, mode switch, navigation)
import { ref } from "vue";
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { trpc } from "@/client";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { debounce } from "@/utils/debounce";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlay";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import {
  renderOverlayMarkersFromData,
  removeOverlayMarkers,
} from "@/composables/map/useCityOverlays";
import type { OverlayData } from "@/types/index";

const isLoading = ref(false);

/**
 * AI : Main viewport content manager
 * AI : Handles all overlay and project rendering based on viewport bounds
 */
export function useViewportContentManager() {
  const overlayStore = useOverlayStore();

  /**
   * AI : Get current map bounds
   */
  function getCurrentBounds() {
    if (!map.value) return null;

    const bounds = map.value.getBounds();
    return {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };
  }

  /**
   * AI : Refresh viewport content - SINGLE RENDERING PATH
   * AI : Called by: pan, zoom, mode switch, navigation
   */
  async function refreshViewport() {
    try {
      if (isLoading.value) return; // AI : Prevent concurrent refreshes

      const bounds = getCurrentBounds();
      if (!bounds || !map.value) return;

      const zoom = map.value.getZoom();
      const mode = overlayStore.mode;

      // AI : CRITICAL: Don't load data until zoomed in past threshold
      // AI : Prevents fetching all overlays/projects on initial page load
      if (zoom < MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD) {
        // AI : Clear any existing overlays/markers when zoomed out
        clearAllOverlays();
        removeOverlayMarkers();
        return;
      }

      isLoading.value = true;

      // AI : Fetch overlays and projects in parallel using spatial queries
      const [overlaysData, projectsData] = await Promise.all([
        trpc.project.getOverlaysInBounds.query({ bounds, mode }),
        trpc.project.getProjectsInBounds.query({ bounds, mode }),
      ]);

      // AI : RENDER based on zoom level
      if (zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) {
        // AI : High zoom - show full overlay images
        renderFullOverlays(overlaysData);
      } else {
        // AI : Low zoom - show markers only
        renderMarkersOnly(overlaysData);
      }

      // AI : Render standalone project markers (projects without overlays)
      const projectIdsWithOverlays = new Set(
        overlaysData.map((o) => o.projectId).filter((id): id is string => id !== null),
      );
      const standaloneProjects = projectsData.filter((p) => !projectIdsWithOverlays.has(p.id));

      // AI : TODO: Render standalone project markers
      // AI :Expected Project type but backend returns { ...project, city: CityData }
      // AI : Need to transform or update type definition
      // for (const project of standaloneProjects) {
      //   addStandaloneProjectMarkerForProject(project);
      // }
    } catch (error) {
      console.error("Error refreshing viewport:", error);
    } finally {
      isLoading.value = false;
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

    // AI : Render overlays
    const existingIds = new Set(Object.keys(overlayStore.overlays));
    const hasExisting = existingIds.size > 0;

    if (!hasExisting) {
      // AI : Initial render
      renderViewModeOverlays(overlaysData, true, false);
    } else {
      // AI : Update existing overlays
      const newDataMap = new Map(overlaysData.map((o) => [o.id, o]));

      // AI : Remove overlays no longer in bounds
      const toRemove: string[] = [];
      for (const id of existingIds) {
        if (!newDataMap.has(id)) {
          toRemove.push(id);
        }
      }

      for (const id of toRemove) {
        overlayStore.removeOverlay(id);
      }

      // AI : Add new overlays
      const newOverlays = overlaysData.filter((o) => !existingIds.has(o.id));
      if (newOverlays.length > 0) {
        renderViewModeOverlays(newOverlays, true, false);
      }
    }
  }

  /**
   * AI : Render overlay markers only (low zoom)
   */
  function renderMarkersOnly(overlaysData: OverlayData[]) {
    // AI : Clear full overlays
    clearAllOverlays();

    // AI : Render markers
    renderOverlayMarkersFromData(overlaysData);
  }

  /**
   * AI : Debounced viewport change handler
   */
  const debouncedRefreshViewport = debounce(refreshViewport, 300);

  /**
   * AI : Setup map event listeners
   */
  function setupEventListeners() {
    if (!map.value) return;

    map.value.on("moveend", debouncedRefreshViewport);
    map.value.on("zoomend", refreshViewport); // AI : No debounce for zoom
  }

  /**
   * AI : Cleanup event listeners
   */
  function cleanupEventListeners() {
    if (!map.value) return;

    map.value.off("moveend", debouncedRefreshViewport);
    map.value.off("zoomend", refreshViewport);
  }

  return {
    refreshViewport,
    setupEventListeners,
    cleanupEventListeners,
    isLoading,
  };
}
