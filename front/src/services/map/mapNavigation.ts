import type { LngLatLike, PaddingOptions } from "maplibre-gl";
import { getMap } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { isMobile } from "@/services/core/viewport";

// Skip re-animation when the camera is already within this many meters of the target.
const distanceThreshold = 10;
// Looser threshold for bounds, which compare centers rather than corners.
const boundsDistanceThreshold = distanceThreshold * 10;

type LatLngInput = [number, number] | { lat: number; lng: number };

interface FlyOptions {
  /** Max animation duration in seconds; scaled down toward 0.3s for short / small-zoom moves. */
  duration?: number;
  /**
   * Screen-space [x, y] offset of the target from container center at rest (negative y = above
   * center). When set, the skip-if-already-there check runs in screen space against that anchor.
   */
  offset?: [number, number];
  /**
   * Top inset (px) used when the mobile drawer is open. Defaults to the overlay-toolbar clearance;
   * pass a smaller value for content with no top toolbar (e.g. vector shapes/points).
   */
  mobileTopInset?: number;
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
  if ("lng" in c && "lat" in c) return { lng: c.lng, lat: c.lat };
  if ("lon" in c && "lat" in c) return { lng: c.lon, lat: c.lat };
  return { lng: 0, lat: 0 };
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

const screenSkipPx = 4;

// Whether the camera is already at `target` so the move can be skipped. With an offset the target
// won't sit at screen center, so we compare its projected position to the anchor (center + offset)
// rather than comparing geographic centers.
function shouldSkipMove(
  target: { lat: number; lng: number },
  zoomDiff: number,
  offset?: [number, number],
): boolean {
  const mlMap = getMap();
  if (zoomDiff >= 0.1) return false;

  if (offset) {
    const el = mlMap.getContainer();
    const desiredX = el.clientWidth / 2 + offset[0];
    const desiredY = el.clientHeight / 2 + offset[1];
    const current = mlMap.project([target.lng, target.lat]);
    return Math.hypot(current.x - desiredX, current.y - desiredY) < screenSkipPx;
  }

  const center = mlMap.getCenter();
  const distance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  return distance < distanceThreshold;
}

// The drawer only covers the map on mobile.
function shouldApplyMobileOffset(): boolean {
  return isMobile.value;
}

// Measures the rendered drawer instead of estimating from mobileDrawerHeightPercent: the drawer is
// sized in vh while innerHeight tracks the visible viewport, and the map container (h-screen) can
// extend below it (mobile URL bar), so an estimate undershoots and content hides under the drawer.
function getMobileDrawerBottomPaddingPx(): number {
  const margin = 30; // margin above the drawer edge
  const drawer = document.querySelector(".draggable-drawer");
  if (drawer) {
    const containerBottom = getMap().getContainer().getBoundingClientRect().bottom;
    const drawerTop = drawer.getBoundingClientRect().top;
    return Math.max(0, containerBottom - drawerTop) + margin;
  }
  const uiStore = useUiStore();
  return (uiStore.mobileDrawerHeightPercent / 100) * globalThis.innerHeight + margin;
}

// Caps padding so opposing insets never exceed the container; otherwise cameraForBounds produces
// a negative numerator and returns a NaN scale (observed crash on small viewports + tight bounds).
function capPaddingToContainer(padding: PaddingOptions | number): PaddingOptions | number {
  const container = getMap().getContainer();
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return padding;

  const capW = Math.max(0, (w - 1) / 2);
  const capH = Math.max(0, (h - 1) / 2);
  if (typeof padding === "number") {
    return Math.min(padding, capW, capH);
  }
  if ((padding.left ?? 0) + (padding.right ?? 0) >= w) {
    padding.left = capW;
    padding.right = capW;
  }
  if ((padding.top ?? 0) + (padding.bottom ?? 0) >= h) {
    padding.top = capH;
    padding.bottom = capH;
  }
  return padding;
}

// MapLibre's cameraForBounds/fitBounds add the camera's persisted padding (kept on the transform
// by the previous flight's padding option) on top of the padding they are given, double-counting
// the insets. Subtract the persisted padding so the effective insets land on the resolved values.
function compensatePersistedPadding(padding: PaddingOptions | number): PaddingOptions {
  const persisted = getMap().getPadding();
  const top = typeof padding === "number" ? padding : (padding.top ?? 0);
  const bottom = typeof padding === "number" ? padding : (padding.bottom ?? 0);
  const left = typeof padding === "number" ? padding : (padding.left ?? 0);
  const right = typeof padding === "number" ? padding : (padding.right ?? 0);
  return {
    top: Math.max(0, top - (persisted.top ?? 0)),
    bottom: Math.max(0, bottom - (persisted.bottom ?? 0)),
    left: Math.max(0, left - (persisted.left ?? 0)),
    right: Math.max(0, right - (persisted.right ?? 0)),
  };
}

// Top inset clearing the overlay editing toolbar when navigating to an overlay on mobile.
const MOBILE_OVERLAY_TOP_INSET = 140;

// Resolves the padding for a camera move, then caps it to the container. When the mobile drawer
// is open this intentionally overrides any caller-provided `p` so the target clears the drawer;
// otherwise `p` is used (single inset, or [horizontal, vertical]), defaulting to 50px.
function resolvePadding(
  p?: number | [number, number],
  mobileTopInset: number = MOBILE_OVERLAY_TOP_INSET,
): PaddingOptions | number {
  let result: PaddingOptions | number = 50;
  if (shouldApplyMobileOffset()) {
    result = {
      top: mobileTopInset,
      bottom: getMobileDrawerBottomPaddingPx(),
      left: 50,
      right: 50,
    };
  } else if (typeof p === "number") {
    result = p;
  } else if (Array.isArray(p)) {
    result = { top: p[1], bottom: p[1], left: p[0], right: p[0] };
  }
  return capPaddingToContainer(result);
}

// Interpolate between 0.3s (tiny move) and maxDuration, saturating at 5000m or 3 zoom levels.
function scaledDuration(centerDistance: number, zoomDiff: number, maxDuration: number): number {
  const minDuration = 0.3;
  const distanceFactor = Math.min(centerDistance / 5000, 1);
  const zoomFactor = Math.min(zoomDiff / 3, 1);
  const t = Math.max(distanceFactor, zoomFactor);
  return minDuration + t * (maxDuration - minDuration);
}

/**
 * Fly to a point, accounting for the mobile drawer covering the bottom of the screen. Returns true
 * if a flight started, false if it was skipped (camera already there) so callers waiting on
 * `moveend` can act immediately instead of hanging.
 */
export function mobileAwareFlyTo(
  latlng: LatLngInput,
  zoom?: number,
  options: FlyOptions = {},
): boolean {
  const mlMap = getMap();
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return false;
  const center = mlMap.getCenter();
  const currentZoom = mlMap.getZoom();
  const targetZoom = zoom ?? currentZoom;

  const zoomDiff = Math.abs(currentZoom - targetZoom);
  if (shouldSkipMove(target, zoomDiff, options.offset)) return false;

  const centerDistance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  const duration = scaledDuration(centerDistance, zoomDiff, options.duration ?? 1.5);

  mlMap.flyTo({
    center: [target.lng, target.lat],
    zoom: targetZoom,
    duration: duration * 1000,
    padding: resolvePadding(undefined, options.mobileTopInset),
    ...(options.offset ? { offset: options.offset } : {}),
    essential: true,
  });
  return true;
}

/**
 * Pure pan with no zoom change, accounting for the mobile drawer offset.
 * Use instead of mobileAwareFlyTo when the zoom level is already correct, to avoid
 * the zoom-out arc that flyTo produces for same-zoom pans.
 */
function mobileAwarePanTo(latlng: LatLngInput, options: FlyOptions = {}): void {
  const mlMap = getMap();
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

  if (shouldSkipMove(target, 0, options.offset)) return;

  const center = mlMap.getCenter();
  const centerDistance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  const duration = scaledDuration(centerDistance, 0, options.duration ?? 0.3);

  mlMap.easeTo({
    center: [target.lng, target.lat],
    duration: duration * 1000,
    padding: resolvePadding(undefined, options.mobileTopInset),
    ...(options.offset ? { offset: options.offset } : {}),
    essential: true,
  });
}

/**
 * Set the camera instantly (no animation), accounting for the mobile drawer offset. Used for cold
 * deep links where the map already booted at the target, so there is no meaningful start view to
 * animate from; only the zoom needs adjusting and that should not be visible.
 */
function mobileAwareJumpTo(latlng: LatLngInput, zoom?: number, options: FlyOptions = {}): void {
  const mlMap = getMap();
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
  const resolved = resolvePadding(undefined, options.mobileTopInset);
  const padding: PaddingOptions =
    typeof resolved === "number"
      ? { top: resolved, bottom: resolved, left: resolved, right: resolved }
      : resolved;
  mlMap.jumpTo({
    center: [target.lng, target.lat],
    ...(zoom === undefined ? {} : { zoom }),
    padding,
  });
}

/** Web Mercator latitude -> world-Y fraction in [0, 1]. */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
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
  padding: PaddingOptions | number,
  maxZoom?: number,
): number {
  const container = getMap().getContainer();
  // Shrink the usable viewport by the same padding the cameraForBounds path would have applied, so
  // the computed zoom fits the bounds in the area actually visible (e.g. above the mobile drawer).
  // Using a fixed inset here instead would over-zoom tall, height-limited bounds and clip them.
  const padLeft = typeof padding === "number" ? padding : (padding.left ?? 0);
  const padRight = typeof padding === "number" ? padding : (padding.right ?? 0);
  const padTop = typeof padding === "number" ? padding : (padding.top ?? 0);
  const padBottom = typeof padding === "number" ? padding : (padding.bottom ?? 0);
  const w = Math.max(1, container.clientWidth - padLeft - padRight);
  const h = Math.max(1, container.clientHeight - padTop - padBottom);
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
 * Fit a bounds, with mobile-aware padding. Returns true if a move started, false if it was skipped
 * (bounds already framed) so callers waiting on `moveend` can act immediately instead of hanging.
 */
export function mobileAwareFlyToBounds(
  bounds: BoundsLike,
  options: FlyToBoundsOptions = {},
): boolean {
  const mlMap = getMap();

  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  // Degenerate (NaN) corners would throw in cameraForBounds.
  if (![west, south, east, north].every((n) => Number.isFinite(n))) return false;

  // Zero-area bounds make cameraForBounds return undefined scale; route to flyTo instead.
  if (west === east && south === north) {
    return mobileAwareFlyTo([north, east], options.maxZoom ?? 17, options);
  }

  const llb: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  const padding = resolvePadding(options.padding);
  // cameraForBounds/fitBounds add the persisted transform padding to this value, so hand them the
  // compensated remainder; the mercator fallback computes from scratch and uses `padding` as is.
  const fitPadding = compensatePersistedPadding(padding);

  const currentZoom = mlMap.getZoom();
  const currentCenter = mlMap.getCenter();

  // cameraForBounds throws "Invalid LngLat (NaN, NaN)" for combos it can't fit (tiny far-away
  // bounds, degenerate quads, padding larger than the viewport). On throw/empty, cameraForBoundsOk
  // stays false and the Mercator fallback below takes over.
  let targetZoom = currentZoom;
  let targetCenter = { lng: currentCenter.lng, lat: currentCenter.lat };
  let cameraForBoundsOk = false;
  try {
    const cam = mlMap.cameraForBounds(llb, { maxZoom: options.maxZoom, padding: fitPadding });
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

  // No usable target: fly to the bounds center at a Mercator-computed zoom, which needs no
  // MapLibre projection and so can't hit the same NaN.
  if (!cameraForBoundsOk) {
    const center: LatLngInput = [(south + north) / 2, (west + east) / 2];
    const zoom = mercatorZoomForBounds(west, south, east, north, padding, options.maxZoom);
    return mobileAwareFlyTo(center, zoom, { duration: options.duration });
  }

  const centerDistance = haversineMeters(
    currentCenter.lat,
    currentCenter.lng,
    targetCenter.lat,
    targetCenter.lng,
  );
  const zoomDiff = Math.abs(currentZoom - targetZoom);

  if (centerDistance < boundsDistanceThreshold && zoomDiff < 0.1) return false; // already framed

  const duration = scaledDuration(centerDistance, zoomDiff, options.duration ?? 1.5);

  // fitBounds runs the same projection math as cameraForBounds, so guard it too.
  try {
    mlMap.fitBounds(llb, {
      maxZoom: options.maxZoom,
      padding: fitPadding,
      duration: duration * 1000,
      essential: true,
    });
    return true;
  } catch {
    /* projection edge case, see above */
    return false;
  }
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
  const cam = getMap().cameraForBounds([
    [lng - halfDegLng, lat - halfDegLat],
    [lng + halfDegLng, lat + halfDegLat],
  ]);
  const zoom = cam?.zoom ?? getMap().getZoom();
  return Math.max(7, Math.min(15, zoom));
}

/**
 * Zoom in to frame a `sizeM`-meter geometry (zoom 14 when unknown), never out, then center the point
 * in the unobstructed map area. `fromMapClick` keeps the desktop camera still since the feature is
 * already on-screen and the docked detail sits beside the map, not over it. Returns whether a move
 * was started.
 */
export function flyToGeometry(
  latlng: LatLngInput,
  sizeM: number,
  options: { fromMapClick?: boolean; instant?: boolean } = {},
): boolean {
  const mlMap = getMap();
  if (options.fromMapClick && !isMobile.value) return false;

  const target = toLatLng(latlng);
  const currentZoom = mlMap.getZoom();
  const idealZoom = sizeM > 0 ? getZoomForGeometrySize(sizeM, target.lat, target.lng) : 14;
  const targetZoom = Math.max(currentZoom, idealZoom);

  // Cold deep link: the map already booted centered on the target, so set the final geometry-fit
  // zoom without an animation rather than flying from the boot zoom.
  if (options.instant) {
    mobileAwareJumpTo(target, targetZoom);
    return true;
  }

  if (targetZoom !== currentZoom) {
    mobileAwareFlyTo(target, targetZoom);
    return true;
  }
  // Same zoom: recenter the feature with drawer-aware padding, so it lands in the map area left
  // visible above the mobile drawer.
  mobileAwarePanTo(target);
  return true;
}
