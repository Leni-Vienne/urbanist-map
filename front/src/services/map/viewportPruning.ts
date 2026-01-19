import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
import { renderViewModeOverlays, createLeafletOverlay } from "@/services/overlay/overlayRendering";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";

import { MAP_CONFIG } from "@/constants/mapConstants";

/**
 * AI : Main pruning function - determines what should be on the map based on bounds
 * AI : Iterates through stores and adds/removes layers from map directly
 */
export function pruneMapEntities() {
  if (!map.value) return;

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

    if (overlay) {
      // AI : Check if overlay is still hidden before removing (user might have switched back)
      // AI : We don't have visibility logic here, but pruneOverlays manages the queue membership.
      // AI : If it's in the queue, it means it SHOULD be removed.
      if (overlay.overlay) {
        overlay.overlay.remove();
        overlay.overlay = null; // AI : Destroy to force fresh reload
      }
      if (overlay.marker) {
        overlay.marker.remove();
      }
    }

    destructionQueue.delete(id);
    processedCount++;
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
  // AI : overlays are only for high zoom levels
  if (zoom < MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) return;

  const overlayStore = useOverlayStore();

  // AI : Helper to check visibility and existence
  // AI : We iterate viewModeOverlays (source of truth for what SHOULD be there)
  // AI : AND existing overlays (to handle edit-mode temporary overlays)

  const processedIds = new Set<string>();

  // 1. Process potential overlays from viewMode (Backend Data)
  for (const data of overlayStore.viewModeOverlays) {
    processedIds.add(data.id);

    if (!data.corners || data.corners.length !== 4) continue;

    const existingInstance = overlayStore.overlays[data.id];

    // AI : OPTIMIZATION: Raw math intersection check to avoid Leaflet object allocation (GC pressure)
    // AI : Bounds: [south, west, north, east]
    const boundsSouth = bounds.getSouth();
    const boundsWest = bounds.getWest();
    const boundsNorth = bounds.getNorth();
    const boundsEast = bounds.getEast();

    // AI : Overlay BBox
    let minLat = data.corners[0].lat;
    let maxLat = data.corners[0].lat;
    let minLng = data.corners[0].lng;
    let maxLng = data.corners[0].lng;

    for (let i = 1; i < 4; i++) {
      const c = data.corners[i];
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }

    // AI : Intersection A and B: A.min < B.max && A.max > B.min
    const isVisible =
      minLat < boundsNorth && maxLat > boundsSouth && minLng < boundsEast && maxLng > boundsWest;

    if (isVisible) {
      if (destructionQueue.has(data.id)) {
        // AI : If timed for destruction but now visible, SAVE IT
        destructionQueue.delete(data.id);
      }

      if (!existingInstance) {
        // AI : Visible but not instantiated -> Create it
        renderViewModeOverlays([data], true, false);
      } else {
        // AI : Exists -> Ensure it's on map (and restored if null)
        const hasLayer = existingInstance.overlay !== null;
        const isOnMap = hasLayer && mapInstance.hasLayer(existingInstance.overlay!);

        if (!hasLayer) {
          // AI : Instance exists but Leaflet layer was destroyed -> Recreate
          renderViewModeOverlays([data], true, false);
        } else if (!isOnMap) {
          existingInstance.overlay!.addTo(mapInstance);
        }

        // AI : Ensure marker
        if (existingInstance.marker && !mapInstance.hasLayer(existingInstance.marker)) {
          existingInstance.marker.addTo(mapInstance);
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

  // 2. Process remaining overlays in store (e.g. newly created ones in Edit Mode)
  // AI : CRITICAL: This loop handles LOCAL/UNSAVED overlays that aren't in viewModeOverlays yet.
  // AI : These should ONLY be visible in 'edit' mode.
  // AI : In 'view' and 'moderation' modes, viewModeOverlays is the exhaustive source of truth.

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    if (processedIds.has(id)) continue;

    // AI : Same logic for these
    if (!overlay.corners || overlay.corners.length !== 4) continue;

    // AI : OPTIMIZATION: Raw math intersection
    const boundsSouth = bounds.getSouth();
    const boundsWest = bounds.getWest();
    const boundsNorth = bounds.getNorth();
    const boundsEast = bounds.getEast();

    let minLat = overlay.corners[0].lat;
    let maxLat = overlay.corners[0].lat;
    let minLng = overlay.corners[0].lng;
    let maxLng = overlay.corners[0].lng;

    for (let i = 1; i < 4; i++) {
      const c = overlay.corners[i];
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }

    // AI : Filter using centralized visibility logic
    // AI : This handles permissions for view/edit/moderation modes
    const authStore = useAuthStore();
    const isAllowedByMode = isOverlayVisible(overlay, overlayStore.mode, authStore.user?.id);

    // AI : Only show if allowed by mode AND within bounds
    const isVisible =
      isAllowedByMode &&
      minLat < boundsNorth &&
      maxLat > boundsSouth &&
      minLng < boundsEast &&
      maxLng > boundsWest;

    const hasLayer = overlay.overlay !== null;
    const isOnMap = hasLayer && mapInstance.hasLayer(overlay.overlay!);

    if (isVisible) {
      if (destructionQueue.has(id)) {
        // AI : If timed for destruction but now visible, SAVE IT
        destructionQueue.delete(id);
      }

      if (!hasLayer) {
        // AI : Recreate overlay if it was destroyed (e.g. valid local/pending overlay coming back into view)
        // AI : This handles the case where we switched modes (hiding pending) and switched back (needing restoration)
        const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay);
        if (newOverlay) {
          overlay.overlay = newOverlay;
          // AI : Ensure corners are set correctly
          if (overlay.corners && overlay.corners.length === 4) {
            const leafletCorners = overlay.corners.map((c) => L.latLng(c.lat, c.lng));
            newOverlay.setCorners(leafletCorners);
          }
          newOverlay.addTo(mapInstance);
        }
      } else if (!isOnMap) {
        overlay.overlay!.addTo(mapInstance);
      }
      if (overlay.marker && !mapInstance.hasLayer(overlay.marker)) {
        overlay.marker.addTo(mapInstance);
      }
    } else {
      // AI : Not visible or not allowed -> Queue for Cleanup
      if (overlay.overlay || overlay.marker) {
        destructionQueue.add(id);
        if (!isDestructionQueueRunning) {
          processDestructionQueue();
        }
      }
    }
  }
}

/**
 * AI : Manage city marker visibility
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function pruneCityMarkers(mapInstance: L.Map, bounds: L.LatLngBounds, _zoom: number) {
  const cityMarkersStore = useCityMarkersStore();
  const allMarkers = cityMarkersStore.getAllCityMarkers();

  for (const [_cityId, marker] of allMarkers) {
    const latLng = marker.getLatLng();
    const isVisible = bounds.contains(latLng);
    const isOnMap = mapInstance.hasLayer(marker);

    if (isVisible && !isOnMap) {
      marker.addTo(mapInstance);
    } else if (!isVisible && isOnMap) {
      marker.remove();
    }
  }
}
