// AI : Overlay marker update functions extracted to break circular dependency
import { createColorIcon } from '@composables/ui/markerIcons';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import type { CDNOverlayData, OverlayObject } from '@types';
import type { Ref, ShallowRef } from 'vue';

// AI : Store refs for marker updates (initialized by initializeOverlayMarkerUpdates)
let overlaysForMarkerUpdates: ShallowRef<Record<string, OverlayObject>>;
let isEditModeForMarkerUpdates: Ref<boolean>;
let currentCityOverlaysForMarkerUpdates: Ref<CDNOverlayData[]>;

// AI : Cache for overlay marker updates 
const overlayDataCache = new Map<string, { corners: { lat: number, lng: number }[] }>();

/**
 * AI : Initialize overlay marker updates with store refs and city overlays
 */
export function initializeOverlayMarkerUpdates(
  storeRefs: {
    overlays: ShallowRef<Record<string, OverlayObject>>;
    isEditMode: Ref<boolean>;
  },
  cityOverlays: Ref<CDNOverlayData[]>
) {
  overlaysForMarkerUpdates = storeRefs.overlays;
  isEditModeForMarkerUpdates = storeRefs.isEditMode;
  currentCityOverlaysForMarkerUpdates = cityOverlays;
}

/**
 * AI : Update overlay markers colors for existing markers
 */
export function updateOverlayMarkersColors(): void {
  if (!currentCityOverlaysForMarkerUpdates?.value || !overlaysForMarkerUpdates?.value) return;

  currentCityOverlaysForMarkerUpdates.value.forEach((cdnOverlay: CDNOverlayData) => {
    const overlayObject = overlaysForMarkerUpdates.value[cdnOverlay.id];
    if (overlayObject?.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, isEditModeForMarkerUpdates.value ? 'edit' : 'view');
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}

/**
 * AI : Update cached overlay data with new corner positions
 */
export function updateCachedOverlayDataForMarkers(overlayId: string, newCorners: { lat: number, lng: number }[]): void {
  if (!overlayId || !newCorners || newCorners.length !== 4) {
    return;
  }
  // AI : Store the updated corners in cache
  overlayDataCache.set(overlayId, {
    corners: [...newCorners]
  });

  // AI : Update the overlay in current city overlays if it exists
  if (currentCityOverlaysForMarkerUpdates?.value) {
    const overlayIndex = currentCityOverlaysForMarkerUpdates.value.findIndex((o: CDNOverlayData) => o.id === overlayId);
    if (overlayIndex !== -1) {
      const overlay = currentCityOverlaysForMarkerUpdates.value[overlayIndex];
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