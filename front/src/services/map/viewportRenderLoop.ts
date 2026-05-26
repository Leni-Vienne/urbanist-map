import L from "leaflet";
import { watch } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
import { legacyLeafletMap } from "@/lib/legacyLeafletMap";
// Dynamic import for chunk splitting - overlayRendering pulls in leaflet-distortableimage
// which is only needed when the user zooms in far enough to see overlay images
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import {
  filterByStatus,
  visibleStates,
  selectedProjectTags,
} from "@/services/overlay/statusFilters";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { refreshAllStandaloneMarkers } from "@/services/map/standaloneProjectMarkers";
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import {
  renderAllProjectShapes,
  initializeShapeRenderTriggers,
} from "@/services/map/projectShapeRenderLoop";
import { initializeMarkerColorTriggers } from "@/services/map/markers";

import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

// Sync a Leaflet layer's presence on the map to match the desired state
function syncLayerToMap(layer: L.Layer | null, shouldBeOnMap: boolean, mapInstance: L.Map) {
  if (!layer) return;
  const isOnMap = mapInstance.hasLayer(layer);
  if (shouldBeOnMap && !isOnMap) layer.addTo(mapInstance);
  else if (!shouldBeOnMap && isOnMap) layer.remove();
}

/**
 * Main pruning function: determines what should be on the map based on bounds.
 * Delegates to two structurally disjoint pipelines:
 *   pruneBackendOverlays  for overlays sourced from the backend (status !== null)
 *   pruneLocalOverlays    for local/unsaved overlays only (status === null)
 */
export function runViewportRenderLoop() {
  // TODO(phase 2-4): the overlay/shape/marker prune pipeline below is Leaflet-based. During the
  // MapLibre migration it iterates empty collections (creation is gated off) and renders nothing;
  // project vector data renders independently via MVT in projectVectorLayers.
  const mapInstance = legacyLeafletMap();
  const mlBounds = map.value.getBounds();
  const zoom = map.value.getZoom();

  // Pad bounds slightly to pre-load items just outside view
  const paddedBounds = L.latLngBounds(
    [mlBounds.getSouth(), mlBounds.getWest()],
    [mlBounds.getNorth(), mlBounds.getEast()],
  ).pad(0.1);

  // Prune Overlays
  pruneOverlays(mapInstance, paddedBounds, zoom);
}

// Drains in batches of 10 per frame to keep bulk teardown (e.g. Edit -> View) off the main thread.
// Destruction is cheaper than creation, so the batch can be larger than the init queue.
const destructionQueue = createRafBatchQueue<null>((_, id) => registry.clearEntry(id), 10);

function queueForDestruction(id: string) {
  destructionQueue.enqueue(id, null);
}

/**
 * Prune overlay visibility, dispatches to two structurally disjoint pipelines.
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // Markers start appearing at VIEWPORT_LOAD_THRESHOLD
  // Images start appearing at MIN_ZOOM_FOR_OVERLAYS
  if (zoom < getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD)) return;

  const showImages = zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  // Markers are always shown past the load threshold, regardless of whether full
  // overlay images are displayed.

  // In view mode, all backend overlays are approved and synced by vectorTileSync.
  // pruneBackendOverlays only runs for edit/moderation to manage pending overlays from
  // viewModeOverlays (approved overlays in those modes are still handled by vectorTileSync).
  const mapStore = useMapStore();
  if (mapStore.mode !== "view") {
    pruneBackendOverlays(mapInstance, bounds, showImages);
  }
  pruneLocalOverlays(mapInstance, showImages);

  // Render shapes for all visible projects (both overlay-bearing and standalone)
  renderAllProjectShapes(mapInstance);
}

// Destroy markers/layers for overlays that are filtered OUT by completion status, so
// toggling a filter off immediately removes the corresponding backend markers.
function queueFilteredOutForDestruction(
  allOverlays: OverlayData[],
  visibleOverlays: OverlayData[],
) {
  const visibleIds = new Set(visibleOverlays.map((o) => o.id));
  for (const data of allOverlays) {
    if (visibleIds.has(data.id)) continue;
    if (registry.getMarker(data.id) || registry.getLayer(data.id)) {
      queueForDestruction(data.id);
    }
  }
}

/**
 * Pipeline 1: Backend overlays (status !== null).
 * Source of truth: viewModeOverlays (already filtered to status !== null by construction).
 * No overlap with pruneLocalOverlays; backend overlays never have status === null.
 */
function pruneBackendOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, showImages: boolean) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const filteredOverlays = filterByStatus(overlayStore.viewModeOverlays, mapStore.mode);
  const overlaysToRender: OverlayData[] = [];

  // Extract bounds once; cornersIntersectBounds reads plain numbers per overlay.
  const viewportBounds = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  for (const data of filteredOverlays) {
    if (data.corners.length !== 4) continue;

    // Prefer live corners so in-progress edits show up. getCorners() throws before the
    // image loads (leaflet-distortableimage reads _corners[0] unguarded).
    const layer = registry.getLayer(data.id);
    let liveCorners: ReturnType<L.DistortableImageOverlay["getCorners"]> | undefined;
    try {
      liveCorners = layer?.getCorners();
    } catch {
      liveCorners = undefined;
    }
    const effectiveCorners = liveCorners?.length === 4 ? liveCorners : data.corners;

    const isInViewport = cornersIntersectBounds(effectiveCorners, viewportBounds);

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // Timed for destruction but now visible again, save it
        destructionQueue.delete(data.id);
      }

      const marker = registry.getMarker(data.id);

      if (!layer && showImages) {
        // Visible but not instantiated → queue for creation
        overlaysToRender.push(data);
      } else if (layer) {
        syncLayerToMap(layer, showImages, mapInstance);
      }

      if (!marker) {
        const overlayObject = overlayStore.overlays[data.id];
        if (overlayObject) createSingleMarker(overlayObject);
      } else {
        syncLayerToMap(marker, true, mapInstance);
      }
    } else if (layer || registry.getMarker(data.id)) {
      // Not visible → queue for cleanup
      queueForDestruction(data.id);
    }
  }

  queueFilteredOutForDestruction(overlayStore.viewModeOverlays, filteredOverlays);

  if (overlaysToRender.length > 0) {
    // Dynamic import keeps leaflet-distortableimage out of the initial bundle
    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true);
    });
  }
}

/**
 * Pipeline 2: Local/unsaved overlays only (status === null).
 * Source: overlayStore.overlays filtered to status === null.
 * Structural gate: if status !== null, skip immediately.
 * These overlays are only visible in edit mode.
 */
function pruneLocalOverlays(mapInstance: L.Map, showImages: boolean) {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const mapStore = useMapStore();
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    // STRUCTURAL GATE, this pipeline owns local overlays exclusively.
    // Backend overlays (status !== null) are handled by pruneBackendOverlays.
    if (overlay.status !== null) continue;

    if (overlay.corners.length !== 4) continue;

    const isAllowedByMode = isOverlayVisible(overlay, mapStore.mode, authStore.user?.id);
    const passesCompletionFilter = filterByStatus([overlay], mapStore.mode).length > 0;

    const layer = registry.getLayer(id);

    // Local overlays are actively being created by the user, no viewport bounds check.
    // overlay.corners is NOT updated during drag, and even live layer corners can be
    // outside the viewport if moveend fires while the overlay has been moved off-screen.
    // Only explicit deletion or a mode switch should remove a local overlay.
    const shouldDisplay = isAllowedByMode && passesCompletionFilter;

    if (shouldDisplay) {
      if (destructionQueue.has(id)) {
        destructionQueue.delete(id);
      }

      const marker = registry.getMarker(id);

      if (!layer && showImages) {
        editOverlaysToRecreate.push(overlay);
      } else if (layer) {
        syncLayerToMap(layer, showImages, mapInstance);
      }

      if (!marker) {
        createSingleMarker(overlay);
      } else {
        syncLayerToMap(marker, true, mapInstance);
      }
    } else {
      const marker = registry.getMarker(id);
      if (layer || marker) {
        queueForDestruction(id);
      }
    }
  }

  if (editOverlaysToRecreate.length > 0) {
    // Dynamic import keeps leaflet-distortableimage out of the initial bundle
    // Capture mode at queue time so beginCreation's atomic mutex prevents races,
    // no manual queuedMode re-check needed (beginCreation returns false if race occurred).
    void import("@/services/overlay/overlayRendering").then(({ createLeafletOverlay }) => {
      for (const overlay of editOverlaysToRecreate) {
        // beginCreation is the single atomic gate:
        //   - returns false if already has a layer (concurrent pruneOverlays call completed first)
        //   - returns false if already being created (in-flight async callback)
        // No separate mode re-check or overlay.overlay guard needed.
        if (!registry.beginCreation(overlay.id)) continue;

        // Pass onReady so the creation mutex is released when the image finishes loading.
        // createLeafletOverlay handles cancelCreation itself on abort/zoom-too-low paths.
        const id = overlay.id;
        const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay, () => {
          registry.cancelCreation(id);
        });

        if (!newOverlay) {
          // Synchronous creation failure (e.g., invalid overlay object)
          registry.cancelCreation(overlay.id);
        }
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
      refreshAllStandaloneMarkers();
      runViewportRenderLoop();
    },
    { deep: true },
  );

  initializeShapeRenderTriggers();
  initializeMarkerColorTriggers();
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
