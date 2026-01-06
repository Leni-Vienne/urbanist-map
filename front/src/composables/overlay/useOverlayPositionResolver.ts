// AI : Centralized overlay position resolution
// AI : Single source of truth for overlay positions - resolves from multiple sources with priority
// AI : Priority: Live Leaflet Instance > Edit Mode Cache > Mode-Aware Cache > Backend Data
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";

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
