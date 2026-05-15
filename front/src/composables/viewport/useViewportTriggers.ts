// Viewport-based content manager
// View mode: vectorTileSync + cluster source handle rendering (no data loading)
// Edit/moderation: bbox tRPC fetch
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
import { clearAllOverlays, clearOverlayLayersOnly } from "@/services/overlay/overlayLifecycle";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import {
  setupKeyboardShortcuts,
  updateOverlayEditingState,
} from "@/services/overlay/overlayEditing";
import { refreshSelectionHighlight } from "@/services/overlay/overlaySelection";
import { pendingChangeRequestsRef } from "@/composables/changes/useChanges";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { clearAllProjectShapes } from "@/services/map/shapeRendering";
import {
  addStandaloneProjectMarkerForProject,
  clearAllStandaloneProjectMarkers,
} from "@/services/map/standaloneProjectMarkers";
import {
  processStandaloneMarkers,
  renderFullOverlays,
  hydrateOverlayStoreObjects,
} from "@/services/navigation/viewportRenderHelpers";
import { filterByStatus } from "@/services/overlay/statusFilters";
import { convertOverlayToData, createProjectObject } from "@/utils/typeFactories";
import { trpc } from "@/client";
import {
  mergeProjectPointsForMode,
  updateGlobalPendingPoints,
} from "@/services/map/clusterSourceMerge";
import type { OverlayData } from "@/types/index";

const isLoading = ref(false);

// Track last zoom level to detect marker ↔ overlay transitions
const lastZoomLevel = ref<number | null>(null);

// Track the last fetched bbox key to avoid redundant fetches on small pans
let lastBboxKey = "";

/**
 * Get current map bbox in the format expected by the backend
 */
function getMapBbox() {
  const bounds = map.value.getBounds();
  // Pad slightly so panning a few pixels doesn't immediately refetch
  const padded = bounds.pad(0.15);
  return {
    minLng: padded.getWest(),
    minLat: padded.getSouth(),
    maxLng: padded.getEast(),
    maxLat: padded.getNorth(),
  };
}

function roundCoord(v: number): string {
  return (Math.round(v * 200) / 200).toFixed(3);
}

/**
 * Quantize a bbox to a coarse grid so nearby viewports produce the same key.
 * Prevents redundant fetches when the user pans a few pixels.
 */
function bboxKey(bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }): string {
  // Round to ~0.005° (~500m at equator), coarse enough to absorb tiny pans
  return `${roundCoord(bbox.minLng)},${roundCoord(bbox.minLat)},${roundCoord(bbox.maxLng)},${roundCoord(bbox.maxLat)}`;
}

/**
 * Main viewport content manager
 * Handles all overlay and project rendering based on viewport bounds
 */
export function useViewportTriggers() {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  /**
   * Fetch overlays + standalone projects in the current viewport bbox.
   */
  async function fetchViewportData(mode: "edit" | "moderation") {
    const bbox = getMapBbox();

    const [overlaysData, projectsData] = await Promise.all([
      trpc.viewport.getOverlaysInViewport.query({ bbox, mode }),
      trpc.viewport.getProjectsInViewport.query({ bbox, mode }),
    ]);

    return { overlays: overlaysData, projects: projectsData };
  }

  /**
   * Render fetched viewport data: hydrate stores, create markers/overlays,
   * process standalone markers, and augment the cluster source.
   */
  function renderViewportData(
    overlaysData: OverlayData[],
    projectsData: Awaited<ReturnType<typeof fetchViewportData>>["projects"],
    fullRender: boolean,
  ) {
    const mode = mapStore.mode;

    if (fullRender) {
      renderFullOverlays(overlaysData);
    } else {
      renderMarkersOnly(overlaysData);
    }

    // Process standalone project markers (projects with 0 visible overlays)
    const standaloneProjects = projectsData.map((p) =>
      createProjectObject(p as Parameters<typeof createProjectObject>[0]),
    );

    // In edit mode, merge local (unsaved) projects into the standalone list
    if (mode === "edit") {
      const localProjects = Object.values(projectStore.projects).filter(
        (p) => p.status === null && p.lat && p.lng,
      );
      for (const lp of localProjects) {
        if (!standaloneProjects.some((sp) => sp.id === lp.id)) {
          standaloneProjects.push(lp);
        }
      }
    }

    processStandaloneMarkers(standaloneProjects, overlaysData);

    // Augment cluster source with pending projects visible in this mode
    mergeProjectPointsForMode(overlaysData, projectsData, mode);
  }

  /**
   * Main viewport refresh, bbox loading for edit/moderation,
   * passthrough for view mode.
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
      const crossedLowToHigh =
        zoom >= loadThreshold &&
        previousZoom !== null &&
        previousZoom < overlayThreshold &&
        zoom >= overlayThreshold;

      // Prune overlays, standalone project markers, and shapes for the current viewport.
      // Skipped when crossing low→high: renderFullOverlays handles pruning after cleanup.
      if (!crossedLowToHigh) {
        runViewportRenderLoop();
      }

      // CRITICAL: Don't load data until zoomed in past threshold
      if (zoom < loadThreshold) {
        const isEditMode = mapStore.mode === "edit";
        clearAllOverlays(isEditMode);
        clearAllStandaloneProjectMarkers();
        lastBboxKey = "";

        // Even though we aren't loading bbox data, we still need to merge global pending points
        if (mapStore.mode !== "view") {
          mergeProjectPointsForMode([], [], mapStore.mode);
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

      // View mode: vectorTileSync and the cluster source handle rendering.
      // runViewportRenderLoop() already ran above for local overlay pruning and shape rendering.
      if (mapStore.mode === "view") {
        return;
      }

      // Edit/moderation: bbox-based loading

      const bbox = getMapBbox();
      const currentKey = bboxKey(bbox);

      // Skip fetch if bbox hasn't changed significantly (unless forced or threshold crossed)
      if (!force && !crossedThreshold && currentKey === lastBboxKey) {
        return;
      }

      isLoading.value = true;
      const mode = mapStore.mode;

      const { overlays: overlaysData, projects: projectsData } = await fetchViewportData(mode);

      // Guard against race condition: if mode changed while fetching, discard.
      if (mapStore.mode !== mode) {
        return;
      }

      lastBboxKey = currentKey;

      const fullRender = zoom >= overlayThreshold;
      renderViewportData(overlaysData, projectsData, fullRender);
    } catch (error) {
      console.error("Error refreshing viewport:", error);
    } finally {
      isLoading.value = false;
    }
  }

  // ── Markers-only rendering (low zoom in edit/moderation) ────────────────

  /**
   * Render overlay markers only (low zoom)
   */
  function renderMarkersOnly(overlaysData: OverlayData[]) {
    const isEditMode = mapStore.mode === "edit";
    clearAllOverlays(true);

    // Collect all overlays to render as markers
    const allOverlaysForMarkers = [...overlaysData];

    // In edit mode, also include preserved overlays from the store that aren't in overlaysData
    if (isEditMode) {
      const overlayDataIds = new Set(overlaysData.map((o) => o.id));
      for (const [id, existing] of Object.entries(overlayStore.overlays)) {
        if (overlayDataIds.has(id)) continue;

        allOverlaysForMarkers.push(convertOverlayToData(existing));
      }
    }

    overlayStore.setViewModeOverlays(allOverlaysForMarkers);
    hydrateOverlayStoreObjects(allOverlaysForMarkers);

    const visibleOverlayIds = new Set(
      filterByStatus(allOverlaysForMarkers, mapStore.mode).map((o) => o.id),
    );

    for (const overlayObject of Object.values(overlayStore.overlays)) {
      if (visibleOverlayIds.has(overlayObject.id)) {
        createSingleMarker(overlayObject);
      }
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────

  const debouncedRefreshViewport = debounce(refreshViewport, 100);

  function setupEventListeners() {
    map.value.on("moveend", () => {
      debouncedRefreshViewport();
    });
    map.value.on("zoomend", () => {
      debouncedRefreshViewport();
    });
  }

  function cleanupEventListeners() {
    map.value.off("moveend");
    map.value.off("zoomend");
  }

  function setupModeWatcher() {
    // When pending change requests finish loading, re-render project shapes
    watch(pendingChangeRequestsRef, () => {
      if (mapStore.mode === "view") return;
      clearAllProjectShapes();
      runViewportRenderLoop();
    });

    // In moderation mode, re-render project shapes once moderation data is ready.
    watch(
      () => useModerationStore().moderationLoaded,
      (loaded) => {
        if (!loaded || mapStore.mode !== "moderation") return;
        clearAllProjectShapes();
        runViewportRenderLoop();
      },
    );

    watch(
      () => mapStore.mode,
      async (newMode, oldMode) => {
        if (newMode === oldMode) return;

        // Clear all standalone project markers on mode switch
        clearAllStandaloneProjectMarkers();

        // Reset bbox tracking on mode switch to force a fresh fetch
        lastBboxKey = "";

        // Switching TO view mode: drop Leaflet refs (tile rendering takes over) but keep
        // overlay store data so in-progress edits survive the round-trip back to edit mode.
        if (newMode === "view") {
          clearOverlayLayersOnly();
          clearAllProjectShapes();
          await updateGlobalPendingPoints("view");
          mergeProjectPointsForMode([], [], "view");
          await updateOverlayEditingState();
          setupKeyboardShortcuts();
          refreshSelectionHighlight();
          return;
        }

        // Switching TO edit or moderation: hide overlays not visible in the new mode
        const hasLoadedOverlays = Object.keys(overlayStore.overlays).length > 0;
        if (hasLoadedOverlays) {
          const currentUserId = authStore.user?.id;
          for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
            if (!isOverlayVisible(overlay, newMode, currentUserId)) {
              registry.clearEntry(id);
            }
          }
        }

        // View mode is tiles-only, so clear before loading bbox data
        if (oldMode === "view") {
          clearAllOverlays(newMode === "edit");
        }

        await updateGlobalPendingPoints(newMode);
        await refreshViewport(true);

        await updateOverlayEditingState();
        setupKeyboardShortcuts();
        refreshSelectionHighlight();

        // In edit mode, also add markers for local (unsaved) projects
        if (newMode === "edit") {
          const userProjects = Object.values(projectStore.projects).filter((p) => {
            if (!p.lat || !p.lng) return false;
            if (p.status === null) return true;
            if (p.status === "pending" && p.ownerId === authStore.user?.id) return true;
            return false;
          });
          for (const project of userProjects) {
            addStandaloneProjectMarkerForProject(project);
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
