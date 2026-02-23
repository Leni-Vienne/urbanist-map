import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
// AI : Dynamic import for chunk splitting - overlayRendering pulls in leaflet-distortableimage
// AI : which is only needed when the user zooms in far enough to see overlay images
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject } from "@/types/index";
import { filterByCompletionStatus } from "@/services/overlay/completionFilters";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";

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
 * AI : Main pruning function - determines what should be on the map based on bounds
 * AI : Iterates through stores and adds/removes layers from map directly
 */
export function pruneMapEntities() {
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
  const overlayStore = useOverlayStore();

  const iterator = destructionQueue.values();
  let result = iterator.next();

  while (!result.done && processedCount < BATCH_SIZE) {
    const id = result.value;
    const overlay = overlayStore.overlays[id];

    if (overlay?.overlay) {
      overlay.overlay.remove();
      overlay.overlay = null; // AI : Destroy to force fresh reload
    }
    if (overlay?.marker) {
      overlay.marker.remove();
    }

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

/**
 * AI : Manage overlay visibility
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // AI : Markers start appearing at VIEWPORT_LOAD_THRESHOLD
  // AI : Images start appearing at MIN_ZOOM_FOR_OVERLAYS
  if (zoom < MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD) return;

  const showImages = zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;
  // AI : Markers are shown whenever we're past the load threshold, regardless of whether
  // AI : full overlay images are displayed. This prevents markers from being toggled off
  // AI : at zoom 13 when they were preserved from a prior zoom-14 session.
  const showMarkers = true; // AI : pruneOverlays already returns early below VIEWPORT_LOAD_THRESHOLD
  const overlayStore = useOverlayStore();

  // AI : Helper to check visibility and existence
  // AI : We iterate viewModeOverlays (source of truth for what SHOULD be there)
  // AI : AND existing overlays (to handle edit-mode temporary overlays)

  const processedIds = new Set<string>();

  // AI : Filter overlays by completion status (for FilterControl to work)
  const filteredOverlays = filterByCompletionStatus(
    overlayStore.viewModeOverlays,
    overlayStore.mode,
  );

  const overlaysToRender: typeof filteredOverlays = [];

  // 1. Process potential overlays from viewMode (Backend Data)
  for (const data of filteredOverlays) {
    processedIds.add(data.id);

    if (data.corners.length !== 4) continue;

    const existingInstance = overlayStore.overlays[data.id];
    const isInViewport = intersectsViewport(computeCornersBBox(data.corners), bounds);

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // AI : If timed for destruction but now visible, SAVE IT
        destructionQueue.delete(data.id);
      }

      if (!existingInstance && showImages) {
        // AI : Visible but not instantiated -> Queue for creation
        overlaysToRender.push(data);
      } else if (existingInstance) {
        // AI : Exists -> Ensure it's on map (and restored if null)
        if (existingInstance.overlay === null && showImages) {
          // AI : Instance exists but Leaflet layer was destroyed -> Queue for recreation
          overlaysToRender.push(data);
        } else {
          syncLayerToMap(existingInstance.overlay, showImages, mapInstance);
        }

        if (existingInstance.marker === null && showMarkers) {
          createSingleMarker(existingInstance);
        } else {
          syncLayerToMap(existingInstance.marker, showMarkers, mapInstance);
        }
      }
    } else if (existingInstance) {
      // AI : Not visible -> Queue for Cleanup
      if (existingInstance.overlay || existingInstance.marker) {
        destructionQueue.add(data.id);
        if (!isDestructionQueueRunning) {
          processDestructionQueue();
        }
      }
    }
  }

  // AI : Verify if we have overlays to render
  if (overlaysToRender.length > 0) {
    // AI : Dynamic import keeps leaflet-distortableimage out of the initial bundle
    // AI : Module is cached after first load, so subsequent calls are essentially synchronous
    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true, false);
    });
  }

  // 2. Process remaining overlays in store (e.g. newly created ones in Edit Mode)
  // AI : CRITICAL: This loop handles LOCAL/UNSAVED overlays that aren't in viewModeOverlays yet.
  // AI : These should ONLY be visible in 'edit' mode.
  // AI : In 'view' and 'moderation' modes, viewModeOverlays is the exhaustive source of truth.

  const authStore = useAuthStore();

  // AI : Collect edit-mode overlays needing Leaflet layer recreation to batch the dynamic import
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    if (processedIds.has(id)) continue;

    if (overlay.corners.length !== 4) continue;

    // AI : Filter using centralized visibility logic
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

      if (overlay.overlay === null && showImages) {
        // AI : Recreate overlay if it was destroyed (e.g. valid local/pending overlay coming back into view)
        // AI : Batched into editOverlaysToRecreate to use a single dynamic import call
        editOverlaysToRecreate.push(overlay);
      } else {
        syncLayerToMap(overlay.overlay, showImages, mapInstance);
      }

      if (overlay.marker === null && showMarkers) {
        createSingleMarker(overlay);
      } else {
        syncLayerToMap(overlay.marker, showMarkers, mapInstance);
      }
    } else if (overlay.overlay || overlay.marker) {
      // AI : Not visible or not allowed -> Queue for Cleanup
      destructionQueue.add(id);
      if (!isDestructionQueueRunning) {
        processDestructionQueue();
      }
    }
  }

  if (editOverlaysToRecreate.length > 0) {
    // AI : Dynamic import keeps leaflet-distortableimage out of the initial bundle
    // AI : Module is cached after first load, so subsequent calls are essentially synchronous
    void import("@/services/overlay/overlayRendering").then(({ createLeafletOverlay }) => {
      for (const overlay of editOverlaysToRecreate) {
        const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay);
        if (newOverlay) {
          overlay.overlay = newOverlay;
          const leafletCorners = overlay.corners.map((c) => L.latLng(c.lat, c.lng));
          newOverlay.setCorners(leafletCorners);
          newOverlay.addTo(mapInstance);
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
