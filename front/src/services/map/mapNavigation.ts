// AI : ============================================================================
// AI : MAP NAVIGATION - Camera bounds, mobile-aware fly, and country navigation
// AI : ============================================================================

import { ref } from "vue";
import L, { type FitBoundsOptions, type ZoomPanOptions } from "leaflet";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import type { CameraBounds } from "@/types/index";
import countryBboxes from "@/assets/country_bboxes.json";

// AI : ============================================================================
// AI : CAMERA BOUNDS TRACKING
// AI : ============================================================================

// AI : Current camera bounds for view mode
const currentCameraBounds = ref<CameraBounds | null>(null);

/**
 * AI : Initialize camera bounds tracking
 */
export function initializeCameraBounds() {
  // AI : Update bounds when map moves or zooms
  function updateBounds() {
    try {
      const bounds = map.value.getBounds();
      const zoom = map.value.getZoom();

      const newBounds: CameraBounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: zoom,
      };
      currentCameraBounds.value = newBounds;
    } catch (error) {
      console.error("Error updating camera bounds:", error);
    }
  }

  // AI : Set initial bounds immediately - no delay needed as map is ready
  updateBounds();

  // AI : Listen for map events - these fire when camera stops moving
  map.value.on("load", updateBounds);
  map.value.on("moveend", updateBounds);
  map.value.on("zoomend", updateBounds);
}

/**
 * AI : Get current camera bounds
 */
export function getCameraBounds() {
  return currentCameraBounds;
}

// AI : ============================================================================
// AI : MOBILE-AWARE NAVIGATION
// AI : ============================================================================

// AI : Minimum distance in meters to skip re-animation when the camera is already close enough.
// AI : distanceTo() returns meters, so 10m ≈ a few map pixels at street-level zoom.
// AI : For bounds comparison (mobileAwareFlyToBounds) the multiplied threshold is 100m,
// AI : which is still well below the size of any overlay (max ~few hundred meters).
const distanceThreshold = 10;

/**
 * AI : Check if mobile drawer is covering the map
 * AI : Only apply offset when on mobile AND drawer is open
 */
function shouldApplyMobileOffset(): boolean {
  const isMobile = globalThis.innerWidth <= 768;
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
  options: ZoomPanOptions = { duration: 1.5 },
): void {
  const latLng = L.latLng(latlng);
  const currentCenter = map.value.getCenter();
  const currentZoom = map.value.getZoom();
  const targetZoom = zoom ?? currentZoom;

  // AI : Check if already at target location and zoom to prevent camera shake
  // AI : Only skip if BOTH distance and zoom are already correct
  const distance = currentCenter.distanceTo(latLng);
  const zoomDiff = Math.abs(currentZoom - targetZoom);

  if (distance < distanceThreshold && zoomDiff < 0.1) {
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
    [latLng.lat + offset, latLng.lng + offset],
  );

  // AI : Use flyToBounds with mobile-aware padding and target zoom
  const fitOptions: FitBoundsOptions = {
    ...options,
    maxZoom: zoom ?? map.value.getZoom(),
    paddingTopLeft: [50, 50],
    paddingBottomRight: [50, globalThis.innerHeight * 0.45],
  };

  map.value.flyToBounds(bounds, fitOptions);
}

/**
 * AI : Scale flight duration based on how far the camera needs to travel.
 * AI : The caller supplies a maximum duration; nearby moves get a shorter one.
 * AI : Breakpoints (linear interpolation between them):
 * AI :   centerDistance < 200 m  AND zoomDiff < 1  →  minDuration (0.3 s)
 * AI :   centerDistance > 5 000 m OR  zoomDiff > 3  →  maxDuration (caller value)
 */
function scaledDuration(centerDistance: number, zoomDiff: number, maxDuration: number): number {
  const minDuration = 0.3;

  // AI : Normalise each axis to [0, 1] then take the max so either axis alone
  // AI : can drive a longer animation (e.g. big zoom-out with little panning).
  const distanceFactor = Math.min(centerDistance / 5000, 1);
  const zoomFactor = Math.min(zoomDiff / 3, 1);
  const t = Math.max(distanceFactor, zoomFactor);

  return minDuration + t * (maxDuration - minDuration);
}

/**
 * AI : Mobile-aware flyToBounds - uses asymmetric padding on mobile
 * AI : Returns true if the flight was skipped (camera already at target), false otherwise
 */
export function mobileAwareFlyToBounds(
  bounds: L.LatLngBoundsExpression,
  options?: FitBoundsOptions,
): boolean {
  const targetBounds = bounds instanceof L.LatLngBounds ? bounds : L.latLngBounds(bounds);
  const currentZoom = map.value.getZoom();

  // AI : For shake prevention with asymmetric padding, we need a different approach
  // AI : Calculate the center point that would result from fitting these bounds
  const targetCenter = targetBounds.getCenter();
  const currentCenter = map.value.getCenter();

  // AI : Check distance between current center and target center
  const centerDistance = currentCenter.distanceTo(targetCenter);

  // AI : Calculate zoom - For asymmetric padding, we can't use getBoundsZoom directly
  // AI : Instead, we'll check if maxZoom is set, or estimate based on bounds size
  let targetZoom = currentZoom;
  if (options?.maxZoom !== undefined) {
    targetZoom = options.maxZoom;
  } else {
    // AI : Estimate zoom based on bounds size (will be refined by Leaflet)
    // AI : This is just for comparison purposes
    targetZoom = map.value.getBoundsZoom(targetBounds, false);
  }

  const zoomDiff = Math.abs(currentZoom - targetZoom);

  // AI : Only skip if center is very close AND zoom is similar
  // AI : Use larger threshold for bounds since we're comparing centers, not corners
  if (centerDistance < distanceThreshold * 10 && zoomDiff < 0.1) {
    return true; // AI : Already viewing these bounds, skip animation
  }

  // AI : Scale duration so nearby overlays don't suffer a comically slow 1.5 s crawl
  const maxDuration = typeof options?.duration === "number" ? options.duration : 1.5;
  const duration = scaledDuration(centerDistance, zoomDiff, maxDuration);

  const applyOffset = shouldApplyMobileOffset();
  const flyOptions: FitBoundsOptions = applyOffset
    ? {
        ...options,
        duration,
        paddingTopLeft: [50, 50] as [number, number],
        paddingBottomRight: [50, globalThis.innerHeight * 0.45] as [number, number], // AI : 45% to cover drawer + margin
      }
    : {
        ...options,
        duration,
        padding: options?.padding ?? ([50, 50] as [number, number]),
      };

  // AI : Use the already-normalized targetBounds for consistency
  map.value.flyToBounds(targetBounds, flyOptions);
  return false;
}

// AI : ============================================================================
// AI : COUNTRY NAVIGATION
// AI : ============================================================================

/**
 * AI : Fly to a country using its bounding box from the bundled JSON.
 * @param countryCode - ISO country code (must be a key of country_bboxes.json)
 * @param duration - Animation duration in seconds (default: 1.5)
 */
export function flyToCountry(countryCode: keyof typeof countryBboxes, duration = 1.5) {
  const bbox = countryBboxes[countryCode];

  // AI : bbox format is [minLng, minLat, maxLng, maxLat]
  mobileAwareFlyToBounds(
    [
      [bbox[1]!, bbox[0]!], // AI : southwest corner [lat, lng]
      [bbox[3]!, bbox[2]!], // AI : northeast corner [lat, lng]
    ],
    {
      duration,
      padding: [30, 30] as [number, number],
    },
  );
}

/**
 * AI : Calculate bounding box for a set of locations
 * AI : Used to determine the view for a city including all its projects and overlays
 */
export function calculateBoundsFromLocations(
  locations: { lat: number; lng: number }[],
): L.LatLngBounds | null {
  if (locations.length === 0) return null;

  try {
    // AI : Map locations to [lat, lng] array
    const latLngs = locations.map((loc) => [loc.lat, loc.lng] as [number, number]);
    return L.latLngBounds(latLngs);
  } catch (error) {
    console.error("Error calculating bounds:", error);
    return null;
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
