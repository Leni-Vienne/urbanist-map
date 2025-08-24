// AI : Extracted city markers update functions to break circular dependency
import { createColorIcon } from '@composables/ui/colorMarkers';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import type { CDNOverlayData } from '@types';

// AI : We'll get these from the stores when needed
let overlays: any;
let isEditMode: any;
let currentCityOverlays: any;

// AI : Initialize with store refs and city markers data
export function initializeCityMarkersUpdater(storeRefs: any, cityOverlays: any) {
  overlays = storeRefs.overlays;
  isEditMode = storeRefs.isEditMode;
  currentCityOverlays = cityOverlays;
}

/**
 * AI : Update overlay markers color and position based on current edit state
 */
export function updateOverlayMarkers(): void {
  if (!currentCityOverlays?.value || !overlays?.value) return;

  currentCityOverlays.value.forEach((cdnOverlay: CDNOverlayData) => {
    const overlayObject = overlays.value[cdnOverlay.id];
    if (overlayObject?.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, isEditMode.value ? 'edit' : 'view');
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}

// AI : Cache for overlay data to persist modifications
const overlayDataCache = new Map<string, { corners: { lat: number, lng: number }[] }>();

/**
 * AI : Update cached overlay data with new corner positions
 */
export function updateCachedOverlayData(overlayId: string, newCorners: { lat: number, lng: number }[]): void {
  if (!overlayId || !newCorners || newCorners.length !== 4) {
    return;
  }
  // AI : Store the updated corners in cache
  overlayDataCache.set(overlayId, {
    corners: [...newCorners]
  });

  // AI : Update the overlay in current city overlays if it exists
  if (currentCityOverlays?.value) {
    const overlayIndex = currentCityOverlays.value.findIndex((o: CDNOverlayData) => o.id === overlayId);
    if (overlayIndex !== -1) {
      const overlay = currentCityOverlays.value[overlayIndex];
      overlay.corners = [...newCorners];
      overlay.isModified = true;
    }
  }
}

/**
 * AI : Get cached overlay data for an overlay
 */
export function getCachedOverlayData(overlayId: string) {
  return overlayDataCache.get(overlayId);
}

/**
 * AI : Clear cached overlay data for a specific overlay
 */
export function clearCachedOverlayData(overlayId: string): void {
  overlayDataCache.delete(overlayId);
}

/**
 * AI : Clear all cached overlay data
 */
export function clearAllCachedOverlayData(): void {
  overlayDataCache.clear();
}