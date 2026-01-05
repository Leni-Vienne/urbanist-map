// AI : Centralized overlay position resolution
// AI : Single source of truth for overlay positions - resolves from multiple sources with priority
// AI : Priority: Live Leaflet Instance > Edit Mode Cache > Mode-Aware Cache > Backend Data
import type L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayObject } from "@/types/index";

/**
 * AI : Resolve overlay corners with priority-based fallback
 * AI : Priority order:
 * AI : 1. Live Leaflet instance (if rendered on map - most current)
 * AI : 2. Edit mode cache (if user moved overlay in edit mode)
 * AI : 3. Mode-aware cache (backend data for current mode)
 * AI : 4. OverlayStore overlays object (fallback)
 * @param overlayId - ID of the overlay
 * @returns Corners array or null if overlay not found
 */
export function resolveOverlayCorners(overlayId: string): { lat: number; lng: number }[] | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : Priority 1: Live Leaflet instance (most accurate, reflects current map state)
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.overlay) {
    try {
      const corners = overlayObject.overlay.getCorners();
      if (corners && corners.length === 4) {
        return corners;
      }
    } catch (error) {
      console.warn(`Failed to get corners from Leaflet overlay ${overlayId}:`, error);
    }
  }

  // AI : Priority 2: Edit mode cache (user modifications not yet saved)
  const editCache = overlayStore.getFromEditModeCache(overlayId);
  if (editCache?.corners && editCache.corners.length === 4) {
    return editCache.corners;
  }

  // AI : Priority 3: Mode-aware cache (backend data for current mode)
  // AI : Need to search through all cached cities to find this overlay
  const currentMode = overlayStore.mode;
  for (const [_cityId, modeCache] of mapStore.cityProjectsCache.entries()) {
    const cachedData = modeCache.get(currentMode);
    if (cachedData) {
      const cachedOverlay = cachedData.find((o) => o.id === overlayId);
      if (cachedOverlay?.corners && cachedOverlay.corners.length === 4) {
        return cachedOverlay.corners;
      }
    }
  }

  // AI : Priority 4: Direct overlay object (fallback)
  if (overlayObject?.corners && overlayObject.corners.length === 4) {
    return overlayObject.corners;
  }

  // AI : Not found in any source
  return null;
}

/**
 * AI : Resolve overlay bounds for navigation
 * AI : Converts resolved corners to Leaflet LatLngBounds
 * @param overlayId - ID of the overlay
 * @returns LatLngBounds or null if overlay not found
 */
export function resolveOverlayBounds(overlayId: string): L.LatLngBounds | null {
  const corners = resolveOverlayCorners(overlayId);

  if (!corners || corners.length !== 4) {
    return null;
  }

  // AI : Create bounds from corners
  const L = (globalThis as any).L;
  if (!L) {
    console.error("Leaflet not loaded");
    return null;
  }

  return L.latLngBounds(corners.map((c: { lat: number; lng: number }) => [c.lat, c.lng]));
}

/**
 * AI : Check if overlay position has been modified from backend state
 * AI : Compares current position with approved backend position
 * @param overlayId - ID of the overlay
 * @returns true if position is modified, false otherwise
 */
export function isOverlayPositionModified(overlayId: string): boolean {
  const overlayStore = useOverlayStore();

  // AI : Check if overlay exists in edit mode cache
  // AI : If it exists there, it has been modified
  const editCache = overlayStore.getFromEditModeCache(overlayId);
  if (editCache?.isModified) {
    return true;
  }

  // AI : Check if overlay object has isModified flag
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.isModified) {
    return true;
  }

  return false;
}

/**
 * AI : Get overlay centroid for marker positioning
 * AI : Calculates center point from resolved corners
 * @param overlayId - ID of the overlay
 * @returns {lat, lng} or null if overlay not found
 */
export function resolveOverlayCentroid(overlayId: string): { lat: number; lng: number } | null {
  const corners = resolveOverlayCorners(overlayId);

  if (!corners || corners.length !== 4) {
    return null;
  }

  // AI : Calculate centroid as average of all corner positions
  const lat = corners.reduce((sum, c) => sum + c.lat, 0) / corners.length;
  const lng = corners.reduce((sum, c) => sum + c.lng, 0) / corners.length;

  return { lat, lng };
}

/**
 * AI : Resolve overlay for a specific source (for debugging/testing)
 * AI : Allows checking which source provides the position
 * @param overlayId - ID of the overlay
 * @returns Source name and corners
 */
export function resolveOverlaySource(overlayId: string): {
  source: "leaflet" | "edit-cache" | "mode-cache" | "overlay-object" | "not-found";
  corners: { lat: number; lng: number }[] | null;
} {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Check Leaflet instance
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.overlay) {
    try {
      const corners = overlayObject.overlay.getCorners();
      if (corners && corners.length === 4) {
        return { source: "leaflet", corners };
      }
    } catch {
      // Ignore error, fall through
    }
  }

  // Check edit cache
  const editCache = overlayStore.getFromEditModeCache(overlayId);
  if (editCache?.corners && editCache.corners.length === 4) {
    return { source: "edit-cache", corners: editCache.corners };
  }

  // Check mode-aware cache
  const currentMode = overlayStore.mode;
  for (const [_cityId, modeCache] of mapStore.cityProjectsCache.entries()) {
    const cachedData = modeCache.get(currentMode);
    if (cachedData) {
      const cachedOverlay = cachedData.find((o) => o.id === overlayId);
      if (cachedOverlay?.corners && cachedOverlay.corners.length === 4) {
        return { source: "mode-cache", corners: cachedOverlay.corners };
      }
    }
  }

  // Check overlay object
  if (overlayObject?.corners && overlayObject.corners.length === 4) {
    return { source: "overlay-object", corners: overlayObject.corners };
  }

  return { source: "not-found", corners: null };
}

/**
 * AI : Get overlay by ID from any source
 * AI : Useful for getting overlay object when you don't know which store has it
 * @param overlayId - ID of the overlay
 * @returns OverlayObject or null
 */
export function resolveOverlayObject(overlayId: string): OverlayObject | null {
  const overlayStore = useOverlayStore();
  return overlayStore.overlays[overlayId] ?? null;
}
