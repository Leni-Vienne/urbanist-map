import type { LngLatLike, PaddingOptions } from "maplibre-gl";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { isMobileViewport } from "@/composables/ui/useIsMobile";
import { DESKTOP_POPUP_ANCHOR_Y_FRACTION } from "@/constants/mapConstants";

// `map.value` is typed non-null but is null until init (see core/map.ts). Public entry points here
// guard with `if (!map.value) return`; private helpers run after that guard and assume non-null.

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

const screenSkipPx = 4;

// Whether the camera is already at `target` so the move can be skipped. With an offset the target
// won't sit at screen center, so we compare its projected position to the anchor (center + offset)
// rather than comparing geographic centers.
function shouldSkipMove(
  target: { lat: number; lng: number },
  zoomDiff: number,
  offset?: [number, number],
): boolean {
  const m = map.value;
  if (zoomDiff >= 0.1) return false;

  if (offset) {
    const el = m.getContainer();
    const desiredX = el.clientWidth / 2 + offset[0];
    const desiredY = el.clientHeight / 2 + offset[1];
    const current = m.project([target.lng, target.lat]);
    return Math.hypot(current.x - desiredX, current.y - desiredY) < screenSkipPx;
  }

  const center = m.getCenter();
  const distance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  return distance < distanceThreshold;
}

// The drawer only covers the map on mobile while it's open.
function shouldApplyMobileOffset(): boolean {
  if (!isMobileViewport()) return false;
  return useUiStore().mobileDrawerVisible;
}

function getMobileDrawerBottomPaddingPx(): number {
  const uiStore = useUiStore();
  const drawerHeightPx = (uiStore.mobileDrawerHeightPercent / 100) * globalThis.innerHeight;
  return drawerHeightPx + 20; // margin above the drawer edge
}

// Mode controls + drawer grip below the drawer edge that an upward popup must also clear.
const MOBILE_DRAWER_CONTROLS_BUFFER = 110;
// Gap kept between the resting anchor and the mobile UI it sits above.
const MOBILE_ANCHOR_BOTTOM_GAP = 24;

/** Bottom px covered by mobile UI (drawer + mode controls) that the project popup opens above. */
export function mobileBottomBlockedPx(): number {
  const uiStore = useUiStore();
  const drawerPx = (uiStore.mobileDrawerHeightPercent / 100) * globalThis.innerHeight;
  return drawerPx + MOBILE_DRAWER_CONTROLS_BUFFER;
}

// Caps padding so opposing insets never exceed the container; otherwise cameraForBounds produces
// a negative numerator and returns a NaN scale (observed crash on small viewports + tight bounds).
function capPaddingToContainer(padding: PaddingOptions | number): PaddingOptions | number {
  const container = map.value.getContainer();
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

// Resolves the padding for a camera move, then caps it to the container. When the mobile drawer
// is open this intentionally overrides any caller-provided `p` so the target clears the drawer;
// otherwise `p` is used (single inset, or [horizontal, vertical]), defaulting to 50px.
function resolvePadding(p?: number | [number, number]): PaddingOptions | number {
  let result: PaddingOptions | number = 50;
  if (shouldApplyMobileOffset()) {
    result = { top: 50, bottom: getMobileDrawerBottomPaddingPx(), left: 50, right: 50 };
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
  const m = map.value;
  if (!m) return false;
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return false;
  const center = m.getCenter();
  const currentZoom = m.getZoom();
  const targetZoom = zoom ?? currentZoom;

  const zoomDiff = Math.abs(currentZoom - targetZoom);
  if (shouldSkipMove(target, zoomDiff, options.offset)) return false;

  const centerDistance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  const duration = scaledDuration(centerDistance, zoomDiff, options.duration ?? 1.5);

  m.flyTo({
    center: [target.lng, target.lat],
    zoom: targetZoom,
    duration: duration * 1000,
    padding: resolvePadding(),
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
  const m = map.value;
  if (!m) return;
  const target = toLatLng(latlng);
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;

  if (shouldSkipMove(target, 0, options.offset)) return;

  const center = m.getCenter();
  const centerDistance = haversineMeters(center.lat, center.lng, target.lat, target.lng);
  const duration = scaledDuration(centerDistance, 0, options.duration ?? 0.3);

  m.easeTo({
    center: [target.lng, target.lat],
    duration: duration * 1000,
    padding: resolvePadding(),
    ...(options.offset ? { offset: options.offset } : {}),
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
  const container = map.value.getContainer();
  // Shrink the usable viewport by a 50px inset per side so the bounds aren't framed edge-to-edge,
  // matching the padding used by the cameraForBounds path.
  const inset = 100;
  const w = Math.max(1, container.clientWidth - inset);
  const h = Math.max(1, container.clientHeight - inset);
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
  const m = map.value;
  if (!m) return false;

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

  const currentZoom = m.getZoom();
  const currentCenter = m.getCenter();

  // cameraForBounds throws "Invalid LngLat (NaN, NaN)" for combos it can't fit (tiny far-away
  // bounds, degenerate quads, padding larger than the viewport). On throw/empty, cameraForBoundsOk
  // stays false and the Mercator fallback below takes over.
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

  // No usable target: fly to the bounds center at a Mercator-computed zoom, which needs no
  // MapLibre projection and so can't hit the same NaN.
  if (!cameraForBoundsOk) {
    const center: LatLngInput = [(south + north) / 2, (west + east) / 2];
    const zoom = mercatorZoomForBounds(west, south, east, north, options.maxZoom);
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
    m.fitBounds(llb, {
      maxZoom: options.maxZoom,
      padding,
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
  const cam = map.value.cameraForBounds([
    [lng - halfDegLng, lat - halfDegLat],
    [lng + halfDegLng, lat + halfDegLat],
  ]);
  const zoom = cam?.zoom ?? map.value.getZoom();
  return Math.max(7, Math.min(15, zoom));
}

/**
 * Zoom in just enough to frame a `sizeM`-meter geometry (zoom 14 when size is unknown), never
 * zooming out. With `allowPan`, pans instead when no zoom is needed, avoiding flyTo's zoom-out arc.
 * Returns true if the anchor was moved to its resting position (so popup placement uses that
 * predicted spot), false if the camera didn't move (placement uses the current projected spot).
 */
export function flyToGeometry(
  latlng: LatLngInput,
  sizeM: number,
  options: { allowPan?: boolean } = {},
): boolean {
  const m = map.value;
  if (!m) return false;
  const target = toLatLng(latlng);
  const currentZoom = m.getZoom();
  const idealZoom = sizeM > 0 ? getZoomForGeometrySize(sizeM, target.lat, target.lng) : 14;
  const targetZoom = Math.max(currentZoom, idealZoom);
  const offset = popupAnchorOffset();

  if (targetZoom !== currentZoom) {
    mobileAwareFlyTo(target, targetZoom, { offset });
    return true;
  }
  if (options.allowPan) {
    mobileAwarePanTo(target, { offset });
    return true;
  }
  return false;
}

/**
 * Screen-space offset that biases a selected project's anchor so the popup has room to open:
 * upper-third on desktop (downward popup), and just above the bottom drawer on mobile (where the
 * drawer forces the popup to open upward). Mirrors desktop, flipped because the obstruction is at
 * the bottom on mobile instead of leaving room below.
 */
export function popupAnchorOffset(): [number, number] | undefined {
  const m = map.value;
  if (!m) return undefined;
  const h = m.getContainer().clientHeight;
  if (h <= 0) return undefined;
  if (isMobileViewport()) {
    // Land the anchor just above the drawer-blocked region (floored at 0.3h so a very tall drawer
    // can't push it off the top). predictedRestingY adds this to the padded center, so the flight
    // and placement agree on where it lands.
    const desiredY = Math.max(h - mobileBottomBlockedPx() - MOBILE_ANCHOR_BOTTOM_GAP, h * 0.3);
    return [0, desiredY - paddedCenterY()];
  }
  return [0, h * (DESKTOP_POPUP_ANCHOR_Y_FRACTION - 0.5)];
}

/** Screen-Y (px) of the viewport center after drawer-aware padding, before any popup offset. */
function paddedCenterY(): number {
  const m = map.value;
  if (!m) return 0;
  const h = m.getContainer().clientHeight;
  const padding = resolvePadding();
  const top = typeof padding === "number" ? padding : (padding.top ?? 0);
  const bottom = typeof padding === "number" ? padding : (padding.bottom ?? 0);
  return (top + (h - bottom)) / 2;
}

/**
 * Screen-Y (px) a camera move will leave the target at, given the current drawer-aware padding and
 * popup anchor offset. Popup placement uses this to predict the resting anchor before `moveend`
 * fires (atAnchor), so the predicted spot matches where the flight actually lands.
 */
export function predictedRestingY(): number {
  return paddedCenterY() + (popupAnchorOffset()?.[1] ?? 0);
}
