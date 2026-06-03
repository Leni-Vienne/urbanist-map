import { ref } from "vue";
import type { LngLatLike, PaddingOptions } from "maplibre-gl";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import type { CameraBounds } from "@/types/index";

const currentCameraBounds = ref<CameraBounds | null>(null);

// Minimum distance in meters to skip re-animation when the camera is already close enough.
// 10m is a few map pixels at street-level zoom. For bounds comparison the threshold is
// multiplied to 100m, still well below the size of any overlay (max ~few hundred meters).
const distanceThreshold = 10;

type LatLngInput = [number, number] | { lat: number; lng: number };

interface FlyOptions {
  /** Animation duration in seconds (converted to milliseconds for MapLibre). */
  duration?: number;
}

interface FlyToBoundsOptions extends FlyOptions {
  maxZoom?: number;
  /** A single inset, or [horizontal, vertical] in pixels. */
  padding?: number | [number, number];
}

/** Structural bounds shape implemented by MapLibre LngLatBounds. */
interface BoundsLike {
  getNorth: () => number;
  getSouth: () => number;
  getEast: () => number;
  getWest: () => number;
}

function toLatLng(p: LatLngInput): { lat: number; lng: number } {
  return Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng };
}

function readLngLat(c: LngLatLike): { lng: number; lat: number } {
  if (Array.isArray(c)) return { lng: c[0], lat: c[1] };
  return { lng: (c as { lng: number }).lng, lat: (c as { lat: number }).lat };
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initialize camera bounds tracking.
 */
export function initializeCameraBounds() {
  const m = map.value;

  function updateBounds() {
    try {
      const bounds = m.getBounds();
      currentCameraBounds.value = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: m.getZoom(),
      };
    } catch (error) {
      console.error("Error updating camera bounds:", error);
    }
  }

  updateBounds();

  m.on("load", updateBounds);
  m.on("moveend", updateBounds);
  m.on("zoomend", updateBounds);
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

function resolvePadding(p?: number | [number, number]): PaddingOptions | number {
  let result: PaddingOptions | number = 50;
  if (shouldApplyMobileOffset()) {
    result = { top: 50, bottom: getMobileDrawerBottomPaddingPx(), left: 50, right: 50 };
  } else if (typeof p === "number") {
    result = p;
  } else if (Array.isArray(p)) {
    result = { top: p[1], bottom: p[1], left: p[0], right: p[0] };
  }

  // Cap padding to the container, otherwise cameraForBounds produces a negative
  // numerator and returns NaN scale (observed crash on small viewports + tight bounds).
  const container = map.value?.getContainer();
  if (!container) return result;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return result;

  const capW = Math.max(0, (w - 1) / 2);
  const capH = Math.max(0, (h - 1) / 2);
  if (typeof result === "number") {
    return Math.min(result, capW, capH);
  }
  if ((result.left ?? 0) + (result.right ?? 0) >= w) {
    result.left = capW;
    result.right = capW;
  }
  if ((result.top ?? 0) + (result.bottom ?? 0) >= h) {
    result.top = capH;
    result.bottom = capH;
  }
  return result;
}

/**
 * Scale flight duration based on how far the camera needs to travel.
 * Breakpoints (linear interpolation between them):
 *   centerDistance < 200 m  AND zoomDiff < 1  →  minDuration (0.3 s)
 *   centerDistance > 5 000 m OR  zoomDiff > 3  →  maxDuration (caller value)
 */
function scaledDuration(centerDistance: number, zoomDiff: number, maxDuration: number): number {
  const minDuration = 0.3;
  const distanceFactor = Math.min(centerDistance / 5000, 1);
  const zoomFactor = Math.min(zoomDiff / 3, 1);
  const t = Math.max(distanceFactor, zoomFactor);
  return minDuration + t * (maxDuration - minDuration);
}

/**
 * Fly to a point, accounting for the mobile drawer covering the bottom of the screen.
 */
export function mobileAwareFlyTo(
  latlng: LatLngInput,
  zoom?: number,
  options: FlyOptions = {},
): void {
  const m = map.value;
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
  const center = m.getCenter();
  const currentZoom = m.getZoom();
  const targetZoom = zoom ?? currentZoom;

  const distance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  const zoomDiff = Math.abs(currentZoom - targetZoom);
  if (distance < distanceThreshold && zoomDiff < 0.1) {
    return; // Already at target, skip animation
  }

  m.flyTo({
    center: [target.lng, target.lat],
    zoom: targetZoom,
    duration: (options.duration ?? 1.5) * 1000,
    padding: resolvePadding(),
    essential: true,
  });
}

/**
 * Pure pan with no zoom change, accounting for the mobile drawer offset.
 * Use instead of mobileAwareFlyTo when the zoom level is already correct, to avoid
 * the zoom-out arc that flyTo produces for same-zoom pans.
 */
function mobileAwarePanTo(latlng: LatLngInput, options: FlyOptions = {}): void {
  const m = map.value;
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
  const center = m.getCenter();
  const distance = haversineMeters(center.lat, center.lng, target.lat, target.lng);

  if (distance < distanceThreshold) {
    return; // Already at target, skip animation
  }

  m.easeTo({
    center: [target.lng, target.lat],
    duration: (options.duration ?? 0.3) * 1000,
    padding: resolvePadding(),
    essential: true,
  });
}

/** Web Mercator latitude -> world-Y fraction in [0, 1]. */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051_129, Math.min(85.051_129, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/**
 * Zoom level that fits a lng/lat bounds within the current viewport, computed directly from
 * Web Mercator math so it works when MapLibre's cameraForBounds throws (NaN at low zoom for tiny
 * far-away bounds). MapLibre uses 512px tiles, so a full world spans 512 * 2^zoom pixels.
 */
function mercatorZoomForBounds(
  west: number,
  south: number,
  east: number,
  north: number,
  maxZoom?: number,
): number {
  const container = map.value?.getContainer();
  // Shrink the usable viewport by a 50px inset per side so the bounds aren't framed edge-to-edge,
  // matching the padding used by the cameraForBounds path.
  const inset = 100;
  const w = Math.max(1, (container?.clientWidth ?? 1) - inset);
  const h = Math.max(1, (container?.clientHeight ?? 1) - inset);
  const tile = 512;

  const lngFraction = Math.max(Math.abs(east - west) / 360, 1e-9);
  const latFraction = Math.max(Math.abs(mercatorY(north) - mercatorY(south)), 1e-9);

  const zoomX = Math.log2(w / (tile * lngFraction));
  const zoomY = Math.log2(h / (tile * latFraction));
  let zoom = Math.min(zoomX, zoomY);
  if (typeof maxZoom === "number" && Number.isFinite(maxZoom)) zoom = Math.min(zoom, maxZoom);
  return Math.max(0, Math.min(zoom, 22));
}

/**
 * Fit a bounds, with mobile-aware padding.
 * Returns true if the flight was skipped (camera already at target), false otherwise.
 */
export function mobileAwareFlyToBounds(
  bounds: BoundsLike,
  options: FlyToBoundsOptions = {},
): boolean {
  const m = map.value;
  if (!m) return false;

  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  if (![west, south, east, north].every((n) => Number.isFinite(n))) {
    // Degenerate bounds (e.g. NaN corners) would throw in cameraForBounds; skip instead.
    return false;
  }

  // Zero-area bounds make cameraForBounds return undefined scale; route to flyTo instead.
  if (west === east && south === north) {
    mobileAwareFlyTo([north, east], options.maxZoom ?? 17, options);
    return false;
  }

  const llb: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  const padding = resolvePadding(options.padding);

  const currentZoom = m.getZoom();
  const currentCenter = m.getCenter();

  // cameraForBounds throws "Invalid LngLat (NaN, NaN)" for bounds/padding combos it can't fit
  // (tiny far-away bounds at low zoom, degenerate quads, padding larger than the viewport).
  // cameraForBoundsOk stays false on throw or empty result; targetZoom/targetCenter then keep
  // the current camera and the Mercator fallback below takes over.
  let targetZoom = currentZoom;
  let targetCenter = { lng: currentCenter.lng, lat: currentCenter.lat };
  let cameraForBoundsOk = false;
  try {
    const cam = m.cameraForBounds(llb, { maxZoom: options.maxZoom, padding });
    if (cam) {
      cameraForBoundsOk = true;
      if (typeof cam.zoom === "number" && Number.isFinite(cam.zoom)) targetZoom = cam.zoom;
      if (cam.center) {
        const c = readLngLat(cam.center);
        if (Number.isFinite(c.lng) && Number.isFinite(c.lat)) targetCenter = c;
      }
    }
  } catch {
    // cameraForBounds throws on projection edge cases; handled by the fallback below.
  }

  // No usable target from cameraForBounds: fly to the bounds center at a Mercator-computed zoom,
  // which needs no MapLibre projection and so can't hit the same NaN.
  if (!cameraForBoundsOk) {
    const center: LatLngInput = [(south + north) / 2, (west + east) / 2];
    const zoom = mercatorZoomForBounds(west, south, east, north, options.maxZoom);
    mobileAwareFlyTo(center, zoom, { duration: options.duration });
    return false;
  }

  const centerDistance = haversineMeters(
    currentCenter.lat,
    currentCenter.lng,
    targetCenter.lat,
    targetCenter.lng,
  );
  const zoomDiff = Math.abs(currentZoom - targetZoom);

  // Larger threshold for bounds since we compare centers, not corners.
  if (centerDistance < distanceThreshold * 10 && zoomDiff < 0.1) {
    return true; // Already viewing these bounds, skip animation
  }

  const maxDuration = options.duration ?? 1.5;
  const duration = scaledDuration(centerDistance, zoomDiff, maxDuration);

  // fitBounds runs the same projection math as cameraForBounds, so guard it too.
  try {
    m.fitBounds(llb, {
      maxZoom: options.maxZoom,
      padding,
      duration: duration * 1000,
      essential: true,
    });
  } catch {
    return false;
  }
  return false;
}

/**
 * Compute the MapLibre zoom level at which a geometry of `sizeMeters` fits
 * within the map's shorter viewport dimension.
 * Uses the Web Mercator ground resolution formula adjusted for latitude.
 */
function getZoomForGeometrySize(sizeMeters: number, lat: number, lng: number): number {
  // 111320m per degree latitude is a standard geodesic constant.
  const halfDegLat = sizeMeters / 2 / 111_320;
  const halfDegLng = halfDegLat / Math.cos((lat * Math.PI) / 180);
  const cam = map.value.cameraForBounds([
    [lng - halfDegLng, lat - halfDegLat],
    [lng + halfDegLng, lat + halfDegLat],
  ]);
  const zoom = cam?.zoom ?? map.value.getZoom();
  return Math.max(7, Math.min(15, zoom));
}

/**
 * Fly to a project anchor, zooming in just enough to frame a geometry of `sizeM` meters
 * (falls back to zoom 14 when the size is 0/unknown). Never zooms out, so a closer view the
 * user already has is preserved. Returns true if the camera zoomed.
 *
 * When no zoom change is needed and `allowPan` is set, pans instead of flying to avoid the
 * zoom-out arc that flyTo produces for same-zoom moves.
 */
export function flyToGeometry(
  latlng: LatLngInput,
  sizeM: number,
  options: { allowPan?: boolean } = {},
): boolean {
  const target = toLatLng(latlng);
  const currentZoom = map.value.getZoom();
  const idealZoom = sizeM > 0 ? getZoomForGeometrySize(sizeM, target.lat, target.lng) : 14;
  const targetZoom = Math.max(currentZoom, idealZoom);
  const willZoom = targetZoom !== currentZoom;
  const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);

  if (willZoom) {
    mobileAwareFlyTo(target, targetZoom, { duration });
  } else if (options.allowPan) {
    mobileAwarePanTo(target, { duration });
  }
  return willZoom;
}
