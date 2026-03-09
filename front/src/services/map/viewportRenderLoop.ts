import type * as L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
// Dynamic import for chunk splitting - overlayRendering pulls in leaflet-distortableimage
// which is only needed when the user zooms in far enough to see overlay images
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import { filterByStatus } from "@/services/overlay/statusFilters";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { renderProjectShapes, hasProjectShapes } from "@/services/map/shapeRendering";
import { handleShapeProjectClick } from "@/services/map/standaloneProjectMarkers";

import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

// Sync a Leaflet layer's presence on the map to match the desired state
function syncLayerToMap(layer: L.Layer | null, shouldBeOnMap: boolean, mapInstance: L.Map) {
  if (!layer) return;
  const isOnMap = mapInstance.hasLayer(layer);
  if (shouldBeOnMap && !isOnMap) layer.addTo(mapInstance);
  else if (!shouldBeOnMap && isOnMap) layer.remove();
}

// Compute bounding box from 4 overlay corners (raw math to avoid Leaflet object allocation / GC pressure)
function computeCornersBBox(corners: { lat: number; lng: number }[]) {
  let minLat = corners[0]!.lat;
  let maxLat = corners[0]!.lat;
  let minLng = corners[0]!.lng;
  let maxLng = corners[0]!.lng;

  for (let i = 1; i < 4; i++) {
    const c = corners[i]!;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

// Check if a bounding box intersects with viewport bounds
function intersectsViewport(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  bounds: L.LatLngBounds,
) {
  return (
    bbox.minLat < bounds.getNorth() &&
    bbox.maxLat > bounds.getSouth() &&
    bbox.minLng < bounds.getEast() &&
    bbox.maxLng > bounds.getWest()
  );
}

/**
 * Main pruning function - determines what should be on the map based on bounds.
 * Delegates to two structurally disjoint pipelines:
 *   pruneBackendOverlays — for overlays sourced from the backend (status !== null)
 *   pruneLocalOverlays   — for local/unsaved overlays only (status === null)
 */
export function runViewportRenderLoop() {
  const mapInstance = map.value;
  const bounds = mapInstance.getBounds();
  const zoom = mapInstance.getZoom();

  // Pad bounds slightly to pre-load items just outside view
  const paddedBounds = bounds.pad(0.1);

  // Prune Overlays
  pruneOverlays(mapInstance, paddedBounds, zoom);

  // Prune City Markers
  pruneCityMarkers(mapInstance, paddedBounds, zoom);
}

/**
 * Queue for progressive overlay destruction to prevent main thread blocking (UI Freeze)
 * Used when hiding many overlays at once (e.g. Edit -> View mode switch)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const destructionQueue = new Set<string>();
let isDestructionQueueRunning = false;

function processDestructionQueue() {
  if (destructionQueue.size === 0) {
    isDestructionQueueRunning = false;
    return;
  }

  isDestructionQueueRunning = true;

  // Process up to 10 overlays per frame
  // Destruction is cheaper than creation, so we can process more
  let processedCount = 0;
  const BATCH_SIZE = 10;

  const iterator = destructionQueue.values();
  let result = iterator.next();

  while (!result.done && processedCount < BATCH_SIZE) {
    const id = result.value;
    registry.clearEntry(id);

    destructionQueue.delete(id);
    processedCount += 1;
    result = iterator.next();
  }

  if (destructionQueue.size > 0) {
    requestAnimationFrame(processDestructionQueue);
  } else {
    isDestructionQueueRunning = false;
  }
}

function queueForDestruction(id: string) {
  destructionQueue.add(id);
  if (!isDestructionQueueRunning) {
    processDestructionQueue();
  }
}

/**
 * Prune overlay visibility — dispatches to two structurally disjoint pipelines.
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // Markers start appearing at VIEWPORT_LOAD_THRESHOLD
  // Images start appearing at MIN_ZOOM_FOR_OVERLAYS
  if (zoom < getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD)) return;

  const showImages = zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  // Markers are shown whenever we're past the load threshold, regardless of whether
  // full overlay images are displayed.
  const showMarkers = true;

  pruneBackendOverlays(mapInstance, bounds, showImages, showMarkers);
  pruneLocalOverlays(mapInstance, bounds, showImages, showMarkers);

  // Render shapes for overlay-bearing projects that have geometry set
  renderOverlayProjectShapes(mapInstance);
}

/**
 * Pipeline 1 — Backend overlays (status !== null).
 * Source of truth: viewModeOverlays (already filtered to status !== null by construction).
 * No overlap with pruneLocalOverlays possible — backend overlays never have status === null.
 */
function pruneBackendOverlays(
  mapInstance: L.Map,
  bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const filteredOverlays = filterByStatus(overlayStore.viewModeOverlays, mapStore.mode);
  const overlaysToRender: OverlayData[] = [];

  for (const data of filteredOverlays) {
    if (data.corners.length !== 4) continue;

    // Hoist layer lookup to use live corners for the viewport check.
    // data.corners is the backend position — stale if the user has moved the overlay
    // in edit mode. When a layer exists, layer.getCorners() reflects the actual
    // current position and is used for the in-viewport decision.
    // When no layer exists yet, data.corners decides whether to create one.
    const layer = registry.getLayer(data.id);
    const liveCorners = layer?.getCorners();
    const effectiveCorners = liveCorners?.length === 4 ? liveCorners : data.corners;

    const isInViewport = intersectsViewport(computeCornersBBox(effectiveCorners), bounds);

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // Timed for destruction but now visible again — save it
        destructionQueue.delete(data.id);
      }

      const marker = registry.getMarker(data.id);

      if (!layer && showImages) {
        // Visible but not instantiated → queue for creation
        overlaysToRender.push(data);
      } else if (layer) {
        syncLayerToMap(layer, showImages, mapInstance);
      }

      if (!marker && showMarkers) {
        const overlayObject = overlayStore.overlays[data.id];
        if (overlayObject) createSingleMarker(overlayObject);
      } else {
        syncLayerToMap(marker, showMarkers, mapInstance);
      }
    } else if (layer || registry.getMarker(data.id)) {
      // Not visible → queue for cleanup
      queueForDestruction(data.id);
    }
  }

  // Destroy markers/layers for overlays that are filtered OUT by completion status.
  // pruneLocalOverlays handles this correctly; mirror the same logic here so that
  // toggling a filter off immediately removes the corresponding backend markers.
  const filteredIds = new Set(filteredOverlays.map((o) => o.id));
  for (const data of overlayStore.viewModeOverlays) {
    if (filteredIds.has(data.id)) continue;
    const marker = registry.getMarker(data.id);
    const layer = registry.getLayer(data.id);
    if (marker || layer) {
      queueForDestruction(data.id);
    }
  }

  if (overlaysToRender.length > 0) {
    // Dynamic import keeps leaflet-distortableimage out of the initial bundle
    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true, false);
    });
  }
}

/**
 * Pipeline 2 — Local/unsaved overlays only (status === null).
 * Source: overlayStore.overlays filtered to status === null.
 * Structural gate: if status !== null, skip immediately — no defensive guards needed.
 * These overlays are ONLY visible in edit mode.
 */
function pruneLocalOverlays(
  mapInstance: L.Map,
  _bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const mapStore = useMapStore();
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    // STRUCTURAL GATE — this pipeline owns local overlays exclusively.
    // Backend overlays (status !== null) are handled by pruneBackendOverlays.
    if (overlay.status !== null) continue;

    if (overlay.corners.length !== 4) continue;

    const isAllowedByMode = isOverlayVisible(overlay, mapStore.mode, authStore.user?.id);
    const passesCompletionFilter = filterByStatus([overlay], mapStore.mode).length > 0;

    const layer = registry.getLayer(id);

    // Local overlays are actively being created by the user — no viewport bounds check.
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

      if (!marker && showMarkers) {
        createSingleMarker(overlay);
      } else {
        syncLayerToMap(marker, showMarkers, mapInstance);
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
    // Capture mode at queue time so beginCreation's atomic mutex prevents races —
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

/**
 * Render shapes for projects that have overlays AND have geometry set.
 * Uses hasProjectShapes guard to avoid duplicate rendering.
 */
function renderOverlayProjectShapes(mapInstance: L.Map) {
  const overlayStore = useOverlayStore();
  const seenProjectIds = new Set<string>();

  for (const overlay of overlayStore.viewModeOverlays) {
    const projectId = overlay.projectId;
    if (!projectId || seenProjectIds.has(projectId)) continue;
    seenProjectIds.add(projectId);

    if (hasProjectShapes(projectId)) continue;

    const project = overlay.project;
    if (!project?.geometry) continue;

    renderProjectShapes(
      project as Parameters<typeof renderProjectShapes>[0],
      mapInstance,
      handleShapeProjectClick,
    );
  }
}

/**
 * Manage city marker visibility.
 * City markers are hidden when zoomed in past the contribution marker threshold —
 * contribution markers take over at that zoom level, so city markers are redundant.
 * Below the threshold, individual markers are shown/hidden based on viewport bounds.
 */
function pruneCityMarkers(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  const cityMarkersStore = useCityMarkersStore();
  const allCityMarkers = cityMarkersStore.cityMarkerMap;
  const shouldShow = zoom < getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD);

  for (const [_cityId, cityMarker] of allCityMarkers) {
    const isOnMap = mapInstance.hasLayer(cityMarker);

    if (!shouldShow) {
      if (isOnMap) cityMarker.remove();
      continue;
    }

    const isInBounds = bounds.contains(cityMarker.getLatLng());
    if (isInBounds && !isOnMap) cityMarker.addTo(mapInstance);
    else if (!isInBounds && isOnMap) cityMarker.remove();
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
