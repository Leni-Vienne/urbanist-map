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

export type LatLngInput = [number, number] | { lat: number; lng: number };

interface FlyOptions {
  /** Animation duration in seconds (converted to milliseconds for MapLibre). */
  duration?: number;
  /** Accepted for call-site compatibility; MapLibre animates regardless. */
  animate?: boolean;
}

interface FlyToBoundsOptions extends FlyOptions {
  maxZoom?: number;
  /** A single inset, or [horizontal, vertical] in pixels. */
  padding?: number | [number, number];
}

/** Structural bounds shape implemented by both Leaflet LatLngBounds and MapLibre LngLatBounds. */
export interface BoundsLike {
  getNorth(): number;
  getSouth(): number;
  getEast(): number;
  getWest(): number;
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

/**
 * Resolve the MapLibre padding for a camera move. On mobile with the drawer open, the
 * target is pushed above the drawer; otherwise the caller's inset (default 50px) is used.
 */
function resolvePadding(p?: number | [number, number]): PaddingOptions | number {
  if (shouldApplyMobileOffset()) {
    return { top: 50, bottom: getMobileDrawerBottomPaddingPx(), left: 50, right: 50 };
  }
  if (typeof p === "number") return p;
  if (Array.isArray(p)) return { top: p[1], bottom: p[1], left: p[0], right: p[0] };
  return 50;
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
export function mobileAwarePanTo(latlng: LatLngInput, options: FlyOptions = {}): void {
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

/**
 * Fit a bounds, with mobile-aware padding.
 * Returns true if the flight was skipped (camera already at target), false otherwise.
 */
export function mobileAwareFlyToBounds(
  bounds: BoundsLike,
  options: FlyToBoundsOptions = {},
): boolean {
  const m = map.value;
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  if (![west, south, east, north].every((n) => Number.isFinite(n))) {
    // Degenerate bounds (e.g. NaN corners) would throw in cameraForBounds; skip instead.
    return false;
  }
  const llb: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  const padding = resolvePadding(options.padding);

  const currentZoom = m.getZoom();
  const currentCenter = m.getCenter();

  const cam = m.cameraForBounds(llb, { maxZoom: options.maxZoom, padding });
  let targetZoom = currentZoom;
  let targetCenter = { lng: currentCenter.lng, lat: currentCenter.lat };
  if (cam) {
    targetZoom = cam.zoom ?? currentZoom;
    if (cam.center) targetCenter = readLngLat(cam.center);
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

  m.fitBounds(llb, {
    maxZoom: options.maxZoom,
    padding,
    duration: duration * 1000,
    essential: true,
  });
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
