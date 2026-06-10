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
import { isOverlayVisible } from "@/services/overlay/visibility";
import { runViewportRenderLoop, initializeRenderTriggers } from "@/services/map/viewportRenderLoop";
import { clearAllOverlays, clearOverlayRenderState } from "@/services/overlay/lifecycle";
import * as registry from "@/services/overlay/renderRegistry";
import { createOverlayMarker } from "@/services/overlay/markers";
import { updateOverlayEditingState } from "@/services/overlay/editing";
import { refreshSelectionHighlight } from "@/services/overlay/selection";
import {
  addStandaloneProjectMarkerForProject,
  clearAllStandaloneProjectMarkers,
  initializeStandaloneMarkerModeWatcher,
} from "@/services/map/standaloneProjectMarkers";
import { filterByStatus } from "@/services/overlay/statusFilters";
import {
  convertOverlayToData,
  createOverlayObject,
  createProjectObject,
} from "@/utils/typeFactories";
import { trpc } from "@/client";
import {
  mergeProjectPointsForMode,
  updateGlobalPendingPoints,
} from "@/services/map/clusterSourceMerge";
import type { OverlayData, Project } from "@/types/index";

function processStandaloneMarkers(
  standaloneProjects: Project[],
  overlaysData: OverlayData[] | null,
  overlayCountByProjectId: Map<string, number>,
): void {
  if (standaloneProjects.length === 0) return;

  const projectIdsWithOverlays = new Set<string>();
  if (overlaysData) {
    for (const overlay of overlaysData) {
      if (overlay.projectId) {
        projectIdsWithOverlays.add(overlay.projectId);
      }
    }
  }

  for (const project of standaloneProjects) {
    // Local (unsaved) projects aren't in the backend response, so they default to 0.
    const overlayCount = overlayCountByProjectId.get(project.id) ?? 0;

    if (!projectIdsWithOverlays.has(project.id) && overlayCount === 0) {
      addStandaloneProjectMarkerForProject(project);
    }
  }
}

function hydrateOverlayStoreObjects(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const updates: Record<string, Partial<OverlayData>> = {};
  for (const overlayData of overlaysData) {
    if (overlayStore.overlays[overlayData.id]) {
      updates[overlayData.id] = {
        hasPendingChanges: overlayData.hasPendingChanges,
        suggestedCorners: overlayData.suggestedCorners,
        pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
        // Approved overlays first loaded via vectorTileSync lack project data.
        // Update it here when the bbox fetch provides it, so the detail panel can resolve activeProject.
        ...(overlayData.project ? { project: overlayData.project } : {}),
      };
    } else {
      overlayStore.addOverlay(overlayData.id, createOverlayObject(overlayData));
    }
  }
  if (Object.keys(updates).length > 0) {
    overlayStore.batchUpdateOverlays(updates);
  }
}

function renderFullOverlays(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();

  overlayStore.setViewModeOverlays(overlaysData);
  hydrateOverlayStoreObjects(overlaysData);

  for (const overlayObject of Object.values(overlayStore.overlays)) {
    createOverlayMarker(overlayObject);
  }

  runViewportRenderLoop();
}

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
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  // Pad slightly so panning a few pixels doesn't immediately refetch
  const padX = (east - west) * 0.15;
  const padY = (north - south) * 0.15;
  return {
    minLng: west - padX,
    minLat: Math.max(-90, south - padY),
    maxLng: east + padX,
    maxLat: Math.min(90, north + padY),
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

// MapLibre's off() needs the exact handler reference to remove a listener, so the viewport
// handlers are kept at module scope.
let viewportMoveEndHandler: (() => void) | null = null;
let viewportZoomEndHandler: (() => void) | null = null;

function cleanupEventListeners() {
  if (viewportMoveEndHandler) {
    map.value.off("moveend", viewportMoveEndHandler);
    viewportMoveEndHandler = null;
  }
  if (viewportZoomEndHandler) {
    map.value.off("zoomend", viewportZoomEndHandler);
    viewportZoomEndHandler = null;
  }
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

    // Process standalone project markers (projects with 0 visible overlays).
    // Capture overlayCount before createProjectObject drops it.
    const overlayCountByProjectId = new Map<string, number>(
      projectsData.map((p) => [p.id, p.overlayCount]),
    );
    const standaloneProjects = projectsData.map((p) =>
      createProjectObject(p as Parameters<typeof createProjectObject>[0]),
    );

    // In edit mode, merge local (unsaved) projects into the standalone list
    if (mode === "edit") {
      const localProjects = Object.values(projectStore.projects).filter(
        (p) => p.status === null && typeof p.lat === "number" && typeof p.lng === "number",
      );
      for (const lp of localProjects) {
        if (!standaloneProjects.some((sp) => sp.id === lp.id)) {
          standaloneProjects.push(lp);
        }
      }
    }

    processStandaloneMarkers(standaloneProjects, overlaysData, overlayCountByProjectId);

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
      // zoom >= overlayThreshold already implies zoom >= loadThreshold (overlay threshold is higher).
      const crossedLowToHigh =
        previousZoom !== null && previousZoom < overlayThreshold && zoom >= overlayThreshold;

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
        createOverlayMarker(overlayObject);
      }
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────

  const debouncedRefreshViewport = debounce(refreshViewport, 100);

  function setupEventListeners() {
    viewportMoveEndHandler = () => {
      debouncedRefreshViewport();
    };
    viewportZoomEndHandler = () => {
      debouncedRefreshViewport();
    };
    map.value.on("moveend", viewportMoveEndHandler);
    map.value.on("zoomend", viewportZoomEndHandler);
  }

  function setupModeWatcher() {
    initializeRenderTriggers();
    initializeStandaloneMarkerModeWatcher();

    watch(
      () => mapStore.mode,
      async (newMode, oldMode) => {
        if (newMode === oldMode) return;

        // Reset bbox tracking on mode switch to force a fresh fetch
        lastBboxKey = "";

        // Switching TO view mode: drop rendered layer refs (tile rendering takes over) but keep
        // overlay store data so in-progress edits survive the round-trip back to edit mode.
        if (newMode === "view") {
          clearOverlayRenderState();
          await updateGlobalPendingPoints("view");
          mergeProjectPointsForMode([], [], "view");
          await updateOverlayEditingState();
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
        refreshSelectionHighlight();
      },
    );
  }

  return {
    refreshViewport,
    setupEventListeners,
    cleanupEventListeners,
    setupModeWatcher,
  };
}
