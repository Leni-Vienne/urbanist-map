import type * as L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
// AI : Dynamic import for chunk splitting - overlayRendering pulls in leaflet-distortableimage
// AI : which is only needed when the user zooms in far enough to see overlay images
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import { filterByCompletionStatus } from "@/services/overlay/completionFilters";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";

import { MAP_CONFIG } from "@/constants/mapConstants";

// AI : Sync a Leaflet layer's presence on the map to match the desired state
function syncLayerToMap(layer: L.Layer | null, shouldBeOnMap: boolean, mapInstance: L.Map) {
  if (!layer) return;
  const isOnMap = mapInstance.hasLayer(layer);
  if (shouldBeOnMap && !isOnMap) layer.addTo(mapInstance);
  else if (!shouldBeOnMap && isOnMap) layer.remove();
}

// AI : Compute bounding box from 4 overlay corners (raw math to avoid Leaflet object allocation / GC pressure)
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

// AI : Check if a bounding box intersects with viewport bounds
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
 * AI : Main pruning function - determines what should be on the map based on bounds.
 * AI : Delegates to two structurally disjoint pipelines:
 * AI :   pruneBackendOverlays — for overlays sourced from the backend (status !== null)
 * AI :   pruneLocalOverlays   — for local/unsaved overlays only (status === null)
 */
export function runViewportRenderLoop() {
  const mapInstance = map.value;
  const bounds = mapInstance.getBounds();
  const zoom = mapInstance.getZoom();

  // AI : Pad bounds slightly to pre-load items just outside view
  const paddedBounds = bounds.pad(0.1);

  // AI : Prune Overlays
  pruneOverlays(mapInstance, paddedBounds, zoom);

  // AI : Prune City Markers
  pruneCityMarkers(mapInstance, paddedBounds, zoom);
}

/**
 * AI : Queue for progressive overlay destruction to prevent main thread blocking (UI Freeze)
 * AI : Used when hiding many overlays at once (e.g. Edit -> View mode switch)
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

  // AI : Process up to 10 overlays per frame
  // AI : Destruction is cheaper than creation, so we can process more
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
 * AI : Prune overlay visibility — dispatches to two structurally disjoint pipelines.
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // AI : Markers start appearing at VIEWPORT_LOAD_THRESHOLD
  // AI : Images start appearing at MIN_ZOOM_FOR_OVERLAYS
  if (zoom < MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD) return;

  const showImages = zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;
  // AI : Markers are shown whenever we're past the load threshold, regardless of whether
  // AI : full overlay images are displayed.
  const showMarkers = true;

  pruneBackendOverlays(mapInstance, bounds, showImages, showMarkers);
  pruneLocalOverlays(mapInstance, bounds, showImages, showMarkers);
}

/**
 * AI : Pipeline 1 — Backend overlays (status !== null).
 * AI : Source of truth: viewModeOverlays (already filtered to status !== null by construction).
 * AI : No overlap with pruneLocalOverlays possible — backend overlays never have status === null.
 */
function pruneBackendOverlays(
  mapInstance: L.Map,
  bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const filteredOverlays = filterByCompletionStatus(
    overlayStore.viewModeOverlays,
    overlayStore.mode,
  );
  const overlaysToRender: OverlayData[] = [];

  for (const data of filteredOverlays) {
    if (data.corners.length !== 4) continue;

    const isInViewport = intersectsViewport(computeCornersBBox(data.corners), bounds);

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // AI : Timed for destruction but now visible again — save it
        destructionQueue.delete(data.id);
      }

      const layer = registry.getLayer(data.id);
      const marker = registry.getMarker(data.id);

      if (!layer && showImages) {
        // AI : Visible but not instantiated → queue for creation
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
    } else {
      // AI : Not visible → queue for cleanup
      const layer = registry.getLayer(data.id);
      const marker = registry.getMarker(data.id);
      if (layer || marker) {
        queueForDestruction(data.id);
      }
    }
  }

  if (overlaysToRender.length > 0) {
    // AI : Dynamic import keeps leaflet-distortableimage out of the initial bundle
    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true, false);
    });
  }
}

/**
 * AI : Pipeline 2 — Local/unsaved overlays only (status === null).
 * AI : Source: overlayStore.overlays filtered to status === null.
 * AI : Structural gate: if status !== null, skip immediately — no defensive guards needed.
 * AI : These overlays are ONLY visible in edit mode.
 */
function pruneLocalOverlays(
  mapInstance: L.Map,
  bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    // AI : STRUCTURAL GATE — this pipeline owns local overlays exclusively.
    // AI : Backend overlays (status !== null) are handled by pruneBackendOverlays.
    if (overlay.status !== null) continue;

    if (overlay.corners.length !== 4) continue;

    const isAllowedByMode = isOverlayVisible(overlay, overlayStore.mode, authStore.user?.id);
    const passesCompletionFilter =
      filterByCompletionStatus([overlay], overlayStore.mode).length > 0;

    const shouldDisplay =
      isAllowedByMode &&
      passesCompletionFilter &&
      intersectsViewport(computeCornersBBox(overlay.corners), bounds);

    if (shouldDisplay) {
      if (destructionQueue.has(id)) {
        destructionQueue.delete(id);
      }

      const layer = registry.getLayer(id);
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
      const layer = registry.getLayer(id);
      const marker = registry.getMarker(id);
      if (layer || marker) {
        queueForDestruction(id);
      }
    }
  }

  if (editOverlaysToRecreate.length > 0) {
    // AI : Dynamic import keeps leaflet-distortableimage out of the initial bundle
    // AI : Capture mode at queue time so beginCreation's atomic mutex prevents races —
    // AI : no manual queuedMode re-check needed (beginCreation returns false if race occurred).
    void import("@/services/overlay/overlayRendering").then(({ createLeafletOverlay }) => {
      for (const overlay of editOverlaysToRecreate) {
        // AI : beginCreation is the single atomic gate:
        // AI :   - returns false if already has a layer (concurrent pruneOverlays call completed first)
        // AI :   - returns false if already being created (in-flight async callback)
        // AI : No separate mode re-check or overlay.overlay guard needed.
        if (!registry.beginCreation(overlay.id)) continue;

        // AI : Pass onReady so the creation mutex is released when the image finishes loading.
        // AI : createLeafletOverlay handles cancelCreation itself on abort/zoom-too-low paths.
        const id = overlay.id;
        const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay, () => {
          registry.cancelCreation(id);
        });

        if (!newOverlay) {
          // AI : Synchronous creation failure (e.g., invalid overlay object)
          registry.cancelCreation(overlay.id);
        }
      }
    });
  }
}

/**
 * AI : Manage city marker visibility
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function pruneCityMarkers(mapInstance: L.Map, bounds: L.LatLngBounds, _zoom: number) {
  const cityMarkersStore = useCityMarkersStore();
  const allCityMarkers = cityMarkersStore.cityMarkerMap;

  for (const [_cityId, cityMarker] of allCityMarkers) {
    const latLng = cityMarker.getLatLng();
    const isInBounds = bounds.contains(latLng);
    const isOnMap = mapInstance.hasLayer(cityMarker);

    if (isInBounds && !isOnMap) {
      cityMarker.addTo(mapInstance);
    } else if (!isInBounds && isOnMap) {
      cityMarker.remove();
    }
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
