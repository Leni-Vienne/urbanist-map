import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
import { renderViewModeOverlays, createLeafletOverlay } from "@/services/overlay/overlayRendering";

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
    } else {
      // AI : Not visible -> Cleanup
      if (existingInstance) {
        if (existingInstance.overlay) {
          existingInstance.overlay.remove();
          existingInstance.overlay = null; // AI : Destroy to force fresh reload
        }
        if (existingInstance.marker) {
          existingInstance.marker.remove();
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

    // AI : Filter out foreign pending overlays (from previous moderation session)
    // AI : Loop 2 handles "local" overlays, but we must ensure we don't accidentally show
    // AI : orphan overlays belonging to other users that were loaded in moderation mode.
    const authStore = useAuthStore();
    const currentUserId = authStore.user?.id;
    const isForeignPending = overlay.status === "pending" && overlay.authorId !== currentUserId;

    // AI : Only show local orphan overlays in edit mode
    // AI : If we are in view/moderation mode, force isVisible to false to trigger cleanup
    const isVisible =
      overlayStore.mode === "edit" &&
      !isForeignPending &&
      minLat < boundsNorth &&
      maxLat > boundsSouth &&
      minLng < boundsEast &&
      maxLng > boundsWest;

    const hasLayer = overlay.overlay !== null;
    const isOnMap = hasLayer && mapInstance.hasLayer(overlay.overlay!);

    if (isVisible) {
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
      if (overlay.overlay) {
        overlay.overlay.remove();
        // AI : Do NOT destroy overlay object for local edits/new uploads, keep it in memory
        // AI : Just remove from map
      }
      if (overlay.marker) {
        overlay.marker.remove();
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

    if (isVisible) {
      if (!isOnMap) {
        marker.addTo(mapInstance);
      }
    } else {
      if (isOnMap) {
        marker.remove();
      }
    }
  }
}
