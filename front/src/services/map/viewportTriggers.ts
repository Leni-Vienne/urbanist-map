// Viewport-based content manager
// View mode: vectorTileSync + cluster source handle rendering (no data loading)
// Edit/moderation: bbox tRPC fetch
// All state is module-scoped: every consumer drives the same single map viewport.
import { watch } from "vue";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible, matchesMapFilters } from "@/services/overlay/visibility";
import { runViewportRenderLoop, initializeRenderTriggers } from "@/services/map/viewportRenderLoop";
import {
  clearAllOverlays,
  clearOverlayImagesOnly,
  clearOverlayRenderState,
} from "@/services/overlay/lifecycle";
import * as registry from "@/services/overlay/mapLayers";
import { createOverlayMarker } from "@/services/overlay/markers";
import { updateOverlayEditingState } from "@/services/overlay/editing";
import {
  convertOverlayToData,
  createOverlayObject,
  overlayWireToData,
} from "@/utils/typeFactories";
import { trpc } from "@/client";
import {
  mergeProjectPointsForMode,
  updateGlobalPendingPoints,
} from "@/services/map/tiles/clusterSourceMerge";
import type { OverlayData } from "@/types/index";

function hydrateOverlayStoreObjects(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const updates: Record<string, Partial<OverlayData>> = {};
  for (const overlayData of overlaysData) {
    if (overlayStore.liveOverlays[overlayData.id]) {
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
  const mapStore = useMapStore();

  overlayStore.setViewModeOverlays(overlaysData);
  hydrateOverlayStoreObjects(overlaysData);

  for (const overlayObject of Object.values(overlayStore.liveOverlays)) {
    if (!matchesMapFilters(overlayObject, mapStore.mode)) continue;
    createOverlayMarker(overlayObject);
  }

  runViewportRenderLoop();
}

let isLoading = false;

// A refresh arrived while a fetch was in flight; re-run once it settles.
let refreshQueued = false;

// Track last zoom level to detect marker ↔ overlay transitions
let lastZoomLevel: number | null = null;

// Track the last fetched bbox key to avoid redundant fetches on small pans
let lastBboxKey = "";

/**
 * Fetch overlays + standalone projects in the given viewport bbox.
 */
async function fetchViewportData(mode: "edit" | "moderation", bbox: ReturnType<typeof getMapBbox>) {
  const [overlaysData, projectsData] = await Promise.all([
    trpc.viewport.getOverlaysInViewport.query({ bbox, mode }),
    trpc.viewport.getProjectsInViewport.query({ bbox, mode }),
  ]);

  return { overlays: overlaysData.map(overlayWireToData), projects: projectsData };
}

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

/**
 * Render fetched viewport data: hydrate stores, create markers/overlays,
 * and augment the cluster source with pending projects visible in this mode.
 */
function renderViewportData(
  overlaysData: OverlayData[],
  projectsData: Awaited<ReturnType<typeof fetchViewportData>>["projects"],
  fullRender: boolean,
) {
  if (fullRender) {
    renderFullOverlays(overlaysData);
  } else {
    renderMarkersOnly(overlaysData);
  }

  mergeProjectPointsForMode(overlaysData, projectsData, useMapStore().mode);
}

/**
 * Render overlay markers only (low zoom in edit/moderation)
 */
function renderMarkersOnly(overlaysData: OverlayData[]) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  clearOverlayImagesOnly();

  // Collect all overlays to render as markers
  const allOverlaysForMarkers = [...overlaysData];

  // In edit mode, also include preserved backend overlays from the store that aren't in
  // overlaysData. Local overlays (status === null) stay out: viewModeOverlays holds backend
  // overlays only, and the render loop's local pipeline draws them.
  if (mapStore.mode === "edit") {
    const overlayDataIds = new Set(overlaysData.map((o) => o.id));
    for (const [id, existing] of Object.entries(overlayStore.liveOverlays)) {
      if (existing.status === null || overlayDataIds.has(id)) continue;

      allOverlaysForMarkers.push(convertOverlayToData(existing));
    }
  }

  overlayStore.setViewModeOverlays(allOverlaysForMarkers);
  hydrateOverlayStoreObjects(allOverlaysForMarkers);

  const visibleOverlayIds = new Set(
    allOverlaysForMarkers.filter((o) => matchesMapFilters(o, mapStore.mode)).map((o) => o.id),
  );

  for (const overlayObject of Object.values(overlayStore.liveOverlays)) {
    if (visibleOverlayIds.has(overlayObject.id)) {
      createOverlayMarker(overlayObject);
    }
  }
}

/**
 * Below the load threshold: drop render state but keep the overlay store, so an
 * in-progress edit session survives zooming out. Edit mode keeps its markers on the map.
 */
function handleLowZoomViewport(zoom: number) {
  const mapStore = useMapStore();
  if (mapStore.mode === "edit") clearOverlayImagesOnly();
  else clearOverlayRenderState();
  lastBboxKey = "";

  // Even though we aren't loading bbox data, we still need to merge global pending points
  if (mapStore.mode !== "view") {
    mergeProjectPointsForMode([], [], mapStore.mode);
  }

  lastZoomLevel = zoom;
}

/** Whether the zoom moved across the marker ↔ overlay threshold in either direction. */
function didCrossOverlayThreshold(
  previousZoom: number | null,
  zoom: number,
  overlayThreshold: number,
): boolean {
  return (
    previousZoom !== null &&
    ((previousZoom < overlayThreshold && zoom >= overlayThreshold) ||
      (previousZoom >= overlayThreshold && zoom < overlayThreshold))
  );
}

/**
 * Main viewport refresh, bbox loading for edit/moderation,
 * passthrough for view mode.
 */
export async function refreshViewport(force = false) {
  if (isLoading && !force) {
    refreshQueued = true;
    return;
  }

  const mapStore = useMapStore();
  let startedFetch = false;
  try {
    const zoom = map.value.getZoom();
    const previousZoom = lastZoomLevel;
    const loadThreshold = getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD);
    const overlayThreshold = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

    // Detect low→high threshold crossing before pruning.
    // zoom >= overlayThreshold already implies zoom >= loadThreshold (overlay threshold is higher).
    const crossedLowToHigh =
      previousZoom !== null && previousZoom < overlayThreshold && zoom >= overlayThreshold;

    // Prune overlays and shapes for the current viewport.
    // Skipped when crossing low→high into a full render: renderFullOverlays re-runs the loop
    // after cleanup. View mode never full-renders, so it always runs the loop here.
    if (!crossedLowToHigh || mapStore.mode === "view") {
      runViewportRenderLoop();
    }

    // CRITICAL: Don't load data until zoomed in past threshold
    if (zoom < loadThreshold) {
      handleLowZoomViewport(zoom);
      return;
    }

    const crossedThreshold = didCrossOverlayThreshold(previousZoom, zoom, overlayThreshold);

    lastZoomLevel = zoom;

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

    isLoading = true;
    startedFetch = true;
    const mode = mapStore.mode;

    const { overlays: overlaysData, projects: projectsData } = await fetchViewportData(mode, bbox);

    // Guard against race condition: if mode changed while fetching, discard.
    if (mapStore.mode !== mode) {
      return;
    }

    lastBboxKey = currentKey;

    renderViewportData(overlaysData, projectsData, zoom >= overlayThreshold);
  } catch (error) {
    console.error("Error refreshing viewport:", error);
    // A failed fetch skips renderFullOverlays, so run the pruning loop here.
    runViewportRenderLoop();
  } finally {
    if (startedFetch) {
      isLoading = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refreshViewport();
      }
    }
  }
}

// ── Event listeners ─────────────────────────────────────────────────────

const debouncedRefreshViewport = debounce(refreshViewport, 100);

// MapLibre's off() needs the exact handler reference to remove a listener.
let viewportMoveEndHandler: (() => void) | null = null;

// Zooming is a camera move in MapLibre, so moveend also fires after zooms.
export function setupEventListeners() {
  viewportMoveEndHandler = () => {
    debouncedRefreshViewport();
  };
  map.value.on("moveend", viewportMoveEndHandler);
}

export function cleanupEventListeners() {
  if (viewportMoveEndHandler) {
    map.value.off("moveend", viewportMoveEndHandler);
    viewportMoveEndHandler = null;
  }
}

// MapView can remount; the watcher ties to global state so once is enough.
let modeWatcherInitialized = false;

export function setupModeWatcher() {
  initializeRenderTriggers();

  if (modeWatcherInitialized) return;
  modeWatcherInitialized = true;

  const mapStore = useMapStore();
  watch(
    () => mapStore.mode,
    async (newMode, oldMode) => {
      // Reset bbox tracking on mode switch to force a fresh fetch
      lastBboxKey = "";

      // Switching TO view mode: drop rendered layer refs (tile rendering takes over) but keep
      // overlay store data so in-progress edits survive the round-trip back to edit mode.
      if (newMode === "view") {
        clearOverlayRenderState();
        await updateGlobalPendingPoints("view");
        mergeProjectPointsForMode([], [], "view");
        updateOverlayEditingState();
        return;
      }

      // Switching TO edit or moderation: hide overlays not visible in the new mode
      const overlayStore = useOverlayStore();
      const currentUserId = useAuthStore().user?.id;
      for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
        if (!isOverlayVisible(overlay, newMode, currentUserId)) {
          registry.clearEntry(id);
        }
      }

      // View mode is tiles-only, so clear before loading bbox data
      if (oldMode === "view") {
        if (newMode === "edit") clearOverlayImagesOnly();
        else clearAllOverlays();
      }

      await updateGlobalPendingPoints(newMode);
      await refreshViewport(true);

      updateOverlayEditingState();
    },
  );
}
