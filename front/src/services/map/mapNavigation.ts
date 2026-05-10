import { ref } from "vue";
import L, { type FitBoundsOptions, type PanOptions, type ZoomPanOptions } from "leaflet";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import type { CameraBounds } from "@/types/index";

const currentCameraBounds = ref<CameraBounds | null>(null);

// Minimum distance in meters to skip re-animation when the camera is already close enough.
// distanceTo() returns meters, so 10m ≈ a few map pixels at street-level zoom.
// For bounds comparison (mobileAwareFlyToBounds) the multiplied threshold is 100m,
// which is still well below the size of any overlay (max ~few hundred meters).
const distanceThreshold = 10;

/**
 * Initialize camera bounds tracking.
 */
export function initializeCameraBounds() {
  function updateBounds() {
    try {
      const bounds = map.value.getBounds();
      const zoom = map.value.getZoom();

      const newBounds: CameraBounds = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom,
      };
      currentCameraBounds.value = newBounds;
    } catch (error) {
      console.error("Error updating camera bounds:", error);
    }
  }

  updateBounds();

  map.value.on("load", updateBounds);
  map.value.on("moveend", updateBounds);
  map.value.on("zoomend", updateBounds);
}

export function getCameraBounds() {
  return currentCameraBounds;
}

/**
 * Check if mobile drawer is covering the map.
 * Only apply offset when on mobile AND drawer is open.
 */
function shouldApplyMobileOffset(): boolean {
  const isMobile = globalThis.innerWidth <= 768;
  if (!isMobile) return false;

  const uiStore = useUiStore();
  return uiStore.mobileDrawerVisible;
}

/**
 * Returns the actual drawer height in pixels based on the current draggable height percentage.
 * Adds a small margin so the target point isn't flush against the drawer edge.
 */
function getMobileDrawerBottomPaddingPx(): number {
  const uiStore = useUiStore();
  const drawerHeightPx = (uiStore.mobileDrawerHeightPercent / 100) * globalThis.innerHeight;
  return drawerHeightPx + 20; // 20px margin above the drawer
}

/**
 * Mobile-aware flyTo - adjusts the target center to account for the drawer
 * covering the bottom half of the screen.
 * Creates a small bounds around the point and uses flyToBounds with mobile-aware padding,
 * leveraging Leaflet's built-in padding logic.
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

  // Check if already at target location and zoom to prevent camera shake
  // Only skip if BOTH distance and zoom are already correct
  const distance = currentCenter.distanceTo(latLng);
  const zoomDiff = Math.abs(currentZoom - targetZoom);

  if (distance < distanceThreshold && zoomDiff < 0.1) {
    return; // Already at target, skip animation
  }

  const applyOffset = shouldApplyMobileOffset();

  if (!applyOffset) {
    // Desktop or drawer closed - center normally
    map.value.flyTo([latLng.lat, latLng.lng], zoom, options);
    return;
  }

  // Mobile with drawer open - use flyToBounds with a tiny bounds around the point
  // This leverages the working padding logic from mobileAwareFlyToBounds
  const offset = 0.001; // Small offset to create minimal bounds
  const bounds = L.latLngBounds(
    [latLng.lat - offset, latLng.lng - offset],
    [latLng.lat + offset, latLng.lng + offset],
  );

  const bottomPadding = getMobileDrawerBottomPaddingPx();
  // Use flyToBounds with mobile-aware padding and target zoom
  const fitOptions: FitBoundsOptions = {
    ...options,
    maxZoom: zoom ?? map.value.getZoom(),
    paddingTopLeft: [50, 50],
    paddingBottomRight: [50, bottomPadding],
  };

  map.value.flyToBounds(bounds, fitOptions);
}

/**
 * Mobile-aware panTo - pure pan with no zoom change, accounting for the mobile drawer offset.
 * Use instead of mobileAwareFlyTo when the zoom level is already correct, to avoid
 * the zoom-out arc that flyTo produces for same-zoom pans.
 */
export function mobileAwarePanTo(
  latlng: L.LatLngExpression,
  options: PanOptions = { animate: true, duration: 0.3 },
): void {
  const latLng = L.latLng(latlng);
  const currentCenter = map.value.getCenter();
  const distance = currentCenter.distanceTo(latLng);

  if (distance < distanceThreshold) {
    return; // Already at target, skip animation
  }

  const applyOffset = shouldApplyMobileOffset();

  if (!applyOffset) {
    map.value.panTo([latLng.lat, latLng.lng], options);
    return;
  }

  // Mobile with drawer open: shift the pan target southward in pixel space.
  // panTo centers on the given point, so panning to a point south of the target
  // makes the target appear in the visible area above the drawer.
  // In Leaflet pixel coords, Y increases southward.
  const drawerPaddingBottom = getMobileDrawerBottomPaddingPx();
  const drawerPaddingTop = 50;
  const verticalOffsetPx = (drawerPaddingBottom - drawerPaddingTop) / 2;
  const currentZoom = map.value.getZoom();
  const targetPixel = map.value.project(latLng, currentZoom);
  const offsetLatLng = map.value.unproject(
    targetPixel.add(L.point(0, verticalOffsetPx)),
    currentZoom,
  );

  map.value.panTo(offsetLatLng, options);
}

/**
 * Scale flight duration based on how far the camera needs to travel.
 * The caller supplies a maximum duration; nearby moves get a shorter one.
 * Breakpoints (linear interpolation between them):
 *   centerDistance < 200 m  AND zoomDiff < 1  →  minDuration (0.3 s)
 *   centerDistance > 5 000 m OR  zoomDiff > 3  →  maxDuration (caller value)
 */
function scaledDuration(centerDistance: number, zoomDiff: number, maxDuration: number): number {
  const minDuration = 0.3;

  // Normalise each axis to [0, 1] then take the max so either axis alone
  // can drive a longer animation (e.g. big zoom-out with little panning).
  const distanceFactor = Math.min(centerDistance / 5000, 1);
  const zoomFactor = Math.min(zoomDiff / 3, 1);
  const t = Math.max(distanceFactor, zoomFactor);

  return minDuration + t * (maxDuration - minDuration);
}

/**
 * Mobile-aware flyToBounds - uses asymmetric padding on mobile
 * Returns true if the flight was skipped (camera already at target), false otherwise
 */
export function mobileAwareFlyToBounds(
  bounds: L.LatLngBoundsExpression,
  options?: FitBoundsOptions,
): boolean {
  const targetBounds = bounds instanceof L.LatLngBounds ? bounds : L.latLngBounds(bounds);
  const currentZoom = map.value.getZoom();

  // For shake prevention with asymmetric padding, we need a different approach
  // Calculate the center point that would result from fitting these bounds
  const targetCenter = targetBounds.getCenter();
  const currentCenter = map.value.getCenter();

  // Check distance between current center and target center
  const centerDistance = currentCenter.distanceTo(targetCenter);

  // Calculate zoom - For asymmetric padding, we can't use getBoundsZoom directly
  // Instead, we'll check if maxZoom is set, or estimate based on bounds size
  let targetZoom = currentZoom;
  if (options?.maxZoom !== undefined) {
    targetZoom = options.maxZoom;
  } else {
    // Estimate zoom based on bounds size (will be refined by Leaflet)
    // This is just for comparison purposes
    targetZoom = map.value.getBoundsZoom(targetBounds, false);
  }

  const zoomDiff = Math.abs(currentZoom - targetZoom);

  // Only skip if center is very close AND zoom is similar
  // Use larger threshold for bounds since we're comparing centers, not corners
  if (centerDistance < distanceThreshold * 10 && zoomDiff < 0.1) {
    return true; // Already viewing these bounds, skip animation
  }

  // Scale duration so nearby overlays don't suffer a comically slow 1.5 s crawl
  const maxDuration = typeof options?.duration === "number" ? options.duration : 1.5;
  const duration = scaledDuration(centerDistance, zoomDiff, maxDuration);

  const applyOffset = shouldApplyMobileOffset();
  const flyOptions: FitBoundsOptions = applyOffset
    ? {
        ...options,
        duration,
        paddingTopLeft: [50, 50] as [number, number],
        paddingBottomRight: [50, getMobileDrawerBottomPaddingPx()] as [number, number],
      }
    : {
        ...options,
        duration,
        padding: options?.padding ?? ([50, 50] as [number, number]),
      };

  // Use the already-normalized targetBounds for consistency
  map.value.flyToBounds(targetBounds, flyOptions);
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
