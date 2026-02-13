import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
import { renderViewModeOverlays, createLeafletOverlay } from "@/services/overlay/overlayRendering";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { filterByCompletionStatus } from "@/services/overlay/completionFilters";

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
    processedCount += 1;
    result = iterator.next();
  }

  if (destructionQueue.size > 0) {
    requestAnimationFrame(processDestructionQueue);
  } else {
    isDestructionQueueRunning = false;
  }
}

// AI : ============================================================================
// AI : HELPER FUNCTIONS FOR OVERLAY PRUNING
// AI : ============================================================================

/**
 * AI : Calculate bounding box (min/max lat/lng) for overlay corners
 */
function calculateOverlayBounds(corners: { lat: number; lng: number }[]) {
  let minLat = corners[0].lat;
  let maxLat = corners[0].lat;
  let minLng = corners[0].lng;
  let maxLng = corners[0].lng;

  for (let i = 1; i < 4; i += 1) {
    const c = corners[i];
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * AI : Check if overlay bounding box intersects with map bounds
 */
function isOverlayInBounds(
  overlayBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  mapBounds: L.LatLngBounds,
): boolean {
  const { minLat, maxLat, minLng, maxLng } = overlayBounds;
  const boundsSouth = mapBounds.getSouth();
  const boundsWest = mapBounds.getWest();
  const boundsNorth = mapBounds.getNorth();
  const boundsEast = mapBounds.getEast();

  // AI : Intersection: A.min < B.max && A.max > B.min
  return minLat < boundsNorth && maxLat > boundsSouth && minLng < boundsEast && maxLng > boundsWest;
}

/**
 * AI : Determine if overlay should be visible based on mode, permissions, filter, and bounds
 */
function shouldShowOverlay(
  overlay: any,
  mode: "view" | "edit" | "moderation",
  userId: string | undefined,
  bounds: L.LatLngBounds,
): boolean {
  // AI : Check corners validity
  if (!overlay.corners || overlay.corners.length !== 4) return false;

  // AI : Check mode-based visibility permissions
  const isAllowedByMode = isOverlayVisible(overlay, mode, userId);
  if (!isAllowedByMode) return false;

  // AI : Check completion filter
  const passesCompletionFilter = filterByCompletionStatus([overlay], mode).length > 0;
  if (!passesCompletionFilter) return false;

  // AI : Check bounds
  const overlayBounds = calculateOverlayBounds(overlay.corners);
  return isOverlayInBounds(overlayBounds, bounds);
}

/**
 * AI : Ensure overlay and marker are visible on map (create or add as needed)
 */
function ensureOverlayVisible(overlay: any, data: any, mapInstance: L.Map): void {
  if (!overlay) {
    // AI : No existing instance - render new from data
    renderViewModeOverlays([data], true, false);
    return;
  }

  const hasLayer = overlay.overlay !== null;
  const isOnMap = hasLayer && mapInstance.hasLayer(overlay.overlay);

  if (!hasLayer) {
    // AI : Layer destroyed - recreate
    const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay);
    if (newOverlay && overlay.corners?.length === 4) {
      overlay.overlay = newOverlay;
      const leafletCorners = overlay.corners.map((c: any) => L.latLng(c.lat, c.lng));
      newOverlay.setCorners(leafletCorners);
      newOverlay.addTo(mapInstance);
    }
  } else if (!isOnMap) {
    overlay.overlay.addTo(mapInstance);
  }

  // AI : Ensure marker
  if (overlay.marker && !mapInstance.hasLayer(overlay.marker)) {
    overlay.marker.addTo(mapInstance);
  }
}

/**
 * AI : Queue overlay for destruction and trigger processing if needed
 */
function queueForDestruction(id: string): void {
  destructionQueue.add(id);
  if (!isDestructionQueueRunning) {
    processDestructionQueue();
  }
}

// AI : ============================================================================
// AI : MAIN PRUNING FUNCTIONS
// AI : ============================================================================

/**
 * AI : Manage overlay visibility
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // AI : Overlays are only for high zoom levels
  if (zoom < MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS) return;

  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const processedIds = new Set<string>();

  // AI : Get filtered overlays from backend (completion filter applied here)
  const filteredOverlays = filterByCompletionStatus(
    overlayStore.viewModeOverlays,
    overlayStore.mode,
  );

  // AI : Loop 1: Process backend overlays (viewModeOverlays)
  for (const data of filteredOverlays) {
    processedIds.add(data.id);

    // AI : Skip invalid overlays
    if (!data.corners || data.corners.length !== 4) continue;

    const existingInstance = overlayStore.overlays[data.id];

    // AI : Check if overlay should be visible (bounds check)
    const overlayBounds = calculateOverlayBounds(data.corners);
    const isVisible = isOverlayInBounds(overlayBounds, bounds);

    if (isVisible) {
      // AI : Save from destruction if queued
      if (destructionQueue.has(data.id)) {
        destructionQueue.delete(data.id);
      }
      // AI : Ensure it's on the map
      ensureOverlayVisible(existingInstance, data, mapInstance);
    } else if (existingInstance?.overlay || existingInstance?.marker) {
      // AI : Queue for cleanup
      queueForDestruction(data.id);
    }
  }

  // AI : Loop 2: Process remaining overlays in store (local/edit mode only)
  // AI : These are LOCAL/UNSAVED overlays not in viewModeOverlays yet
  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    if (processedIds.has(id)) continue;

    // AI : Use unified visibility check (includes mode permissions, completion filter, and bounds)
    const isVisible = shouldShowOverlay(overlay, overlayStore.mode, authStore.user?.id, bounds);

    if (isVisible) {
      // AI : Save from destruction if queued
      if (destructionQueue.has(id)) {
        destructionQueue.delete(id);
      }
      // AI : Ensure it's on the map
      ensureOverlayVisible(overlay, overlay, mapInstance);
    } else if (overlay.overlay || overlay.marker) {
      // AI : Queue for cleanup
      queueForDestruction(id);
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

// AI : Accept HMR updates for this module
if (import.meta.hot) {
  import.meta.hot.accept();
}
