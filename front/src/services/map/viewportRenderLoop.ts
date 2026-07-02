import { LngLatBounds } from "maplibre-gl";
import { watch } from "vue";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { map } from "@/services/core/map";
import { matchesMapFilters, shouldDisplayOverlay } from "@/services/overlay/visibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import { visibleStates, selectedProjectTags } from "@/services/map/filters";
import { createOverlayMarker, initializeMarkerColorTriggers } from "@/services/overlay/markers";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import * as registry from "@/services/overlay/mapLayers";
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import {
  renderAllProjectShapes,
  initializeShapeRenderTriggers,
} from "@/services/map/shapes/renderLoop";

import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

let renderLoopRafId: number | null = null;

/**
 * Coalesces repeated calls into a single run on the next animation frame.
 * The loop reads live map state, so collapsing same-frame calls is safe and
 * avoids redundant work when several triggers fire together (page load,
 * style switch, or a prune + full render within one viewport refresh).
 */
export function runViewportRenderLoop() {
  if (renderLoopRafId !== null) return;
  renderLoopRafId = requestAnimationFrame(() => {
    renderLoopRafId = null;
    runViewportRenderLoopNow();
  });
}

/**
 * Main pruning function: determines what should be on the map based on bounds.
 * Delegates to two structurally disjoint pipelines:
 *   pruneBackendOverlays  for overlays sourced from the backend (status !== null)
 *   pruneLocalOverlays    for local/unsaved overlays only (status === null)
 */
function runViewportRenderLoopNow() {
  const mlMap = map.value;
  const mlBounds = mlMap.getBounds();
  const zoom = mlMap.getZoom();

  const sw = mlBounds.getSouthWest();
  const ne = mlBounds.getNorthEast();
  const latPad = (ne.lat - sw.lat) * 0.1;
  const lngPad = (ne.lng - sw.lng) * 0.1;
  const paddedBounds = new LngLatBounds(
    [sw.lng - lngPad, Math.max(-90, sw.lat - latPad)],
    [ne.lng + lngPad, Math.min(90, ne.lat + latPad)],
  );

  pruneOverlays(paddedBounds, zoom);
}

// Drains in batches of 10 per frame to keep bulk teardown (e.g. Edit -> View) off the main thread.
// Destruction is cheaper than creation, so the batch can be larger than the init queue.
const destructionQueue = createRafBatchQueue<null>((_, id) => registry.clearEntry(id), 10);

function queueForDestruction(id: string) {
  destructionQueue.enqueue(id, null);
}

/**
 * Prune overlay visibility, dispatches to two structurally disjoint pipelines.
 * Image draw visibility past MIN_ZOOM_FOR_OVERLAYS is handled by each raster layer's minzoom,
 * so this loop only decides whether the source/marker exist, not whether they draw.
 */
function pruneOverlays(bounds: LngLatBounds, zoom: number) {
  if (zoom < getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD)) return;

  const viewportBounds: ViewportBounds = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  // In view mode, all backend overlays are approved and synced by vectorTileSync.
  // pruneBackendOverlays only runs for edit/moderation to manage pending overlays from
  // viewModeOverlays (approved overlays in those modes are still handled by vectorTileSync).
  const mapStore = useMapStore();
  if (mapStore.mode !== "view") {
    pruneBackendOverlays(viewportBounds);
  }
  pruneLocalOverlays();

  // Render shapes for all visible projects (both overlay-bearing and standalone)
  renderAllProjectShapes();
}

// Destroy markers/images for overlays that are filtered OUT by completion status, so
// toggling a filter off immediately removes the corresponding backend content.
function queueFilteredOutForDestruction(
  allOverlays: OverlayData[],
  visibleOverlays: OverlayData[],
) {
  const visibleIds = new Set(visibleOverlays.map((o) => o.id));
  for (const data of allOverlays) {
    if (visibleIds.has(data.id)) continue;
    if (registry.getMarker(data.id) || registry.getImageHandle(data.id)) {
      queueForDestruction(data.id);
    }
  }
}

/**
 * Pipeline 1: Backend overlays (status !== null).
 * Source of truth: viewModeOverlays (already filtered to status !== null by construction).
 * No overlap with pruneLocalOverlays; backend overlays never have status === null.
 */
function pruneBackendOverlays(bounds: ViewportBounds) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const filteredOverlays = overlayStore.viewModeOverlays.filter((o) =>
    matchesMapFilters(o, mapStore.mode),
  );
  const overlaysToRender: OverlayData[] = [];

  for (const data of filteredOverlays) {
    if (data.baselineCorners.length !== 4) continue;

    // Prefer live corners so in-progress edits show up in the viewport test.
    const liveCorners = getOverlayImageCorners(data.id);
    const effectiveCorners = liveCorners?.length === 4 ? liveCorners : data.baselineCorners;

    const isInViewport = cornersIntersectBounds(effectiveCorners, bounds);
    const hasImage = registry.getImageHandle(data.id) !== null;
    const hasMarker = registry.getMarker(data.id) !== null;

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // Timed for destruction but now visible again, save it
        destructionQueue.delete(data.id);
      }

      if (!hasImage) {
        // renderViewModeOverlays(..., true) creates the image source and the status marker.
        overlaysToRender.push(data);
      } else if (!hasMarker) {
        const overlayObject = overlayStore.liveOverlays[data.id];
        if (overlayObject) createOverlayMarker(overlayObject);
      }
    } else if (hasImage || hasMarker) {
      queueForDestruction(data.id);
    }
  }

  queueFilteredOutForDestruction(overlayStore.viewModeOverlays, filteredOverlays);

  if (overlaysToRender.length > 0) {
    void import("@/services/overlay/rendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true);
    });
  }
}

/**
 * Pipeline 2: Local/unsaved overlays only (status === null).
 * Source: overlayStore.liveOverlays filtered to status === null.
 * Structural gate: if status !== null, skip immediately.
 * These overlays are only visible in edit mode.
 */
function pruneLocalOverlays() {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const mapStore = useMapStore();
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
    // STRUCTURAL GATE, this pipeline owns local overlays exclusively.
    // Backend overlays (status !== null) are handled by pruneBackendOverlays.
    if (overlay.status !== null) continue;

    if (overlay.baselineCorners.length !== 4) continue;

    // Local overlays are actively being created by the user, no viewport bounds check.
    // Only explicit deletion or a mode switch should remove a local overlay.
    const shouldDisplay = shouldDisplayOverlay(overlay, mapStore.mode, authStore.user?.id);

    const hasImage = registry.getImageHandle(id) !== null;
    const hasMarker = registry.getMarker(id) !== null;

    if (shouldDisplay) {
      if (destructionQueue.has(id)) {
        destructionQueue.delete(id);
      }
      if (!hasImage) editOverlaysToRecreate.push(overlay);
      if (!hasMarker) createOverlayMarker(overlay);
    } else if (hasImage || hasMarker) {
      queueForDestruction(id);
    }
  }

  if (editOverlaysToRecreate.length > 0) {
    void import("@/services/overlay/rendering").then(({ createOverlayImageForObject }) => {
      for (const overlay of editOverlaysToRecreate) {
        createOverlayImageForObject(overlay);
      }
    });
  }
}

// Data-load / filter triggers that re-run the render loop.
// Shape-specific triggers live in initializeShapeRenderTriggers; marker color triggers in markers.ts.
let renderTriggersInitialized = false;
export function initializeRenderTriggers() {
  // MapView can remount; the watchers below tie to global state so once is enough.
  if (renderTriggersInitialized) return;
  renderTriggersInitialized = true;

  watch(
    () => ({ status: visibleStates.value, tags: selectedProjectTags.value }),
    () => {
      runViewportRenderLoop();
    },
    { deep: true },
  );

  initializeShapeRenderTriggers();
  initializeMarkerColorTriggers();
}
