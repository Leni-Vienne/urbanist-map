// AI : ============================================================================
// AI : MAP NAVIGATION - Camera bounds, mobile-aware fly, and country navigation
// AI : ============================================================================
// AI : Unified map camera control combining bounds tracking, mobile offset handling,
// AI : and country-specific navigation with bounding boxes
// AI : ============================================================================

import { ref } from 'vue';
import L from 'leaflet';
import type { FitBoundsOptions, ZoomPanOptions } from 'leaflet';
import { map } from '@composables/core/useMap';
import { useUiStore } from '@stores/uiStore';
import type { CameraBounds } from '@types';
import countryBboxes from '@assets/country_bboxes.json';

// AI : ============================================================================
// AI : CAMERA BOUNDS TRACKING
// AI : ============================================================================

// AI : Current camera bounds for view mode
const currentCameraBounds = ref<CameraBounds | null>(null);

// AI : Callbacks to call when camera stops moving
const onCameraStopCallbacks: Array<(bounds: CameraBounds) => void> = [];

/**
 * AI : Initialize camera bounds tracking
 */
export function initializeCameraBounds() {
  if (!map.value) {
    console.warn('Map not available for camera bounds tracking');
    return;
  }

  // AI : Update bounds when map moves or zooms
  function updateBounds() {
    if (!map.value) {
      console.warn('Map not available in updateBounds');
      return;
    }

    try {
      const bounds = map.value.getBounds();
      if (!bounds) {
        console.warn('Map bounds not available');
        return;
      }

      const zoom = map.value.getZoom();
      if (zoom === undefined || zoom === null) {
        console.warn('Map zoom not available');
        return;
      }

      const newBounds: CameraBounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: zoom
      };
      currentCameraBounds.value = newBounds;

      // AI : Call all registered callbacks when camera stops moving
      onCameraStopCallbacks.forEach(callback => { callback(newBounds); });
    } catch (error) {
      console.error('Error updating camera bounds:', error);
    }
  }

  // AI : Set initial bounds immediately - no delay needed as map is ready
  updateBounds();

  // AI : Listen for map events - these fire when camera stops moving
  map.value.on('load', updateBounds);
  map.value.on('moveend', updateBounds);
  map.value.on('zoomend', updateBounds);
}

/**
 * AI : Get current camera bounds
 */
export function getCameraBounds() {
  return currentCameraBounds;
}

/**
 * AI : Register callback to be called when camera stops moving
 */
export function onCameraStop(callback: (bounds: CameraBounds) => void) {
  onCameraStopCallbacks.push(callback);
  
  // AI : Return unsubscribe function
  return () => {
    const index = onCameraStopCallbacks.indexOf(callback);
    if (index > -1) {
      onCameraStopCallbacks.splice(index, 1);
    }
  };
}

// AI : ============================================================================
// AI : MOBILE-AWARE NAVIGATION
// AI : ============================================================================

// AI : Minimum distance to prevent odd looking flyTo animations if user is already at target
const distanceThreshold = 0.003;

/**
 * AI : Check if mobile drawer is covering the map
 * AI : Only apply offset when on mobile AND drawer is open
 */
function shouldApplyMobileOffset(): boolean {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) return false;
  
  const uiStore = useUiStore();
  return uiStore.mobileDrawerVisible;
}

/**
 * AI : Mobile-aware flyTo - adjusts center on mobile to account for drawer
 * AI : Strategy: Create a small bounds around the point and use flyToBounds with mobile-aware padding
 * AI : This leverages Leaflet's built-in padding logic which already works correctly
 */
export function mobileAwareFlyTo(
  latlng: L.LatLngExpression,
  zoom?: number,
  options?: ZoomPanOptions
): void {
  if (!map.value) return;

  const latLng = L.latLng(latlng);
  const currentCenter = map.value.getCenter();
  const currentZoom = map.value.getZoom();
  const targetZoom = zoom ?? currentZoom;

  // AI : Check if already at target location and zoom to prevent camera shake
  const distance = currentCenter.distanceTo(latLng);
  
  if (distance < distanceThreshold && Math.abs(currentZoom - targetZoom) < 0.1) {
    return; // AI : Already at target, skip animation
  }

  if (!shouldApplyMobileOffset()) {
    // AI : Desktop or drawer closed - center normally
    map.value.flyTo([latLng.lat, latLng.lng], zoom, options);
    return;
  }

  // AI : Mobile with drawer open - use flyToBounds with a tiny bounds around the point
  // AI : This leverages the working padding logic from mobileAwareFlyToBounds
  const offset = 0.001; // AI : Small offset to create minimal bounds
  const bounds = L.latLngBounds(
    [latLng.lat - offset, latLng.lng - offset],
    [latLng.lat + offset, latLng.lng + offset]
  );

  // AI : Use flyToBounds with mobile-aware padding and target zoom
  const fitOptions: FitBoundsOptions = {
    ...options,
    maxZoom: zoom ?? map.value.getZoom(),
    paddingTopLeft: [50, 50] as [number, number],
    paddingBottomRight: [50, window.innerHeight * 0.45] as [number, number]
  };

  map.value.flyToBounds(bounds, fitOptions);
}

/**
 * AI : Mobile-aware flyToBounds - uses asymmetric padding on mobile
 */
export function mobileAwareFlyToBounds(
  bounds: L.LatLngBoundsExpression,
  options?: FitBoundsOptions
): void {
  if (!map.value) return;

  // AI : Convert bounds expression to LatLngBounds object for comparison
  const targetBounds = bounds instanceof L.LatLngBounds 
    ? bounds 
    : L.latLngBounds(bounds);
  const currentBounds = map.value.getBounds();

  // AI : Check if already viewing the same bounds to prevent camera shake
  const sameNorth = Math.abs(currentBounds.getNorth() - targetBounds.getNorth()) < distanceThreshold;
  const sameSouth = Math.abs(currentBounds.getSouth() - targetBounds.getSouth()) < distanceThreshold;
  const sameEast = Math.abs(currentBounds.getEast() - targetBounds.getEast()) < distanceThreshold;
  const sameWest = Math.abs(currentBounds.getWest() - targetBounds.getWest()) < distanceThreshold;

  if (sameNorth && sameSouth && sameEast && sameWest) {
    return; // AI : Already viewing these bounds, skip animation
  }

  const applyOffset = shouldApplyMobileOffset();
  const flyOptions: FitBoundsOptions = applyOffset
    ? {
        ...options,
        paddingTopLeft: [50, 50] as [number, number],
        paddingBottomRight: [50, window.innerHeight * 0.45] as [number, number] // AI : 45% to cover drawer + margin
      }
    : {
        ...options,
        padding: options?.padding ?? [50, 50] as [number, number]
      };

  map.value.flyToBounds(bounds, flyOptions);
}

// AI : ============================================================================
// AI : COUNTRY NAVIGATION
// AI : ============================================================================

/**
 * AI : Fly to a country using its bounding box or fallback to coordinates with zoom
 * @param countryCode - ISO country code
 * @param fallbackLat - Fallback latitude if bbox not found
 * @param fallbackLng - Fallback longitude if bbox not found
 * @param fallbackZoom - Fallback zoom level (default: 6)
 * @param duration - Animation duration in seconds (default: 1.5)
 */
export function flyToCountry(
  countryCode: string,
  fallbackLat?: number,
  fallbackLng?: number,
  fallbackZoom = 6,
  duration = 1.5
) {
  if (!map.value) return;

  const bbox = countryBboxes[countryCode as keyof typeof countryBboxes];

  if (bbox) {
    // AI : bbox format is [minLng, minLat, maxLng, maxLat]
    mobileAwareFlyToBounds(
      [
        [bbox[1], bbox[0]], // AI : southwest corner [lat, lng]
        [bbox[3], bbox[2]]  // AI : northeast corner [lat, lng]
      ],
      {
        duration,
        padding: [30, 30] as [number, number]
      }
    );
  } else if (fallbackLat !== undefined && fallbackLng !== undefined) {
    // AI : Fallback to flyTo if no bbox found
    mobileAwareFlyTo([fallbackLat, fallbackLng], fallbackZoom, {
      duration
    });
  }
}
