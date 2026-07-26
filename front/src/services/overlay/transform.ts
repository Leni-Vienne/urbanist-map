import * as maplibre from "maplibre-gl";
import type { LatLng } from "@/types/index";

// Web Mercator is undefined beyond ~±85.06°. A corner that is finite but out of range (or
// otherwise malformed) projects to Infinity inside cameraForBounds and crashes the camera, so
// bad quads are rejected before they reach marker placement, navigation, or image rendering.
const MAX_MERCATOR_LAT = 85.06;

function isValidCorner(c: LatLng): boolean {
  return (
    Number.isFinite(c.lng) &&
    Number.isFinite(c.lat) &&
    Math.abs(c.lat) <= MAX_MERCATOR_LAT &&
    Math.abs(c.lng) <= 180
  );
}

export function isValidQuad(corners: LatLng[] | undefined | null): corners is LatLng[] {
  return corners?.length === 4 && corners.every(isValidCorner);
}

// Shape guards for untyped wire values (change-request JSONB geometry).
function isLatLng(value: unknown): value is LatLng {
  return (
    typeof value === "object" &&
    value !== null &&
    "lat" in value &&
    "lng" in value &&
    typeof value.lat === "number" &&
    typeof value.lng === "number"
  );
}

function isLatLngArray(value: unknown): value is LatLng[] {
  return Array.isArray(value) && value.length > 0 && value.every(isLatLng);
}

// Parse an untyped wire geometry value into a validated 4-corner quad, or null.
export function parseQuadValue(value: unknown): LatLng[] | null {
  return isLatLngArray(value) && isValidQuad(value) ? value : null;
}

// Parse an untyped wire geometry value into a validated single coordinate, or null.
export function parsePointValue(value: unknown): LatLng | null {
  return isLatLng(value) && isValidCorner(value) ? value : null;
}

// Exact per-coordinate compare. Valid only for corners that both come from wire/store data, never
// from a GL read-back (the rigid transform is not float-stable through cornersToTransform).
export function sameCorners(a: LatLng[] | null, b: LatLng[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((c, i) => c.lat === b[i]?.lat && c.lng === b[i].lng);
}

// Rigid overlay model used while editing. Storage stays as 4 corners; this is in-memory only.
export interface OverlayTransform {
  center: { lat: number; lng: number };
  width: number; // meters
  height: number; // meters
  bearing: number; // degrees, clockwise in mercator space
}

// Corner order matches the DB ring: [TL, TR, BR, BL].
export const SIGN: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function toMercator(corner: { lat: number; lng: number }) {
  return maplibre.MercatorCoordinate.fromLngLat({ lng: corner.lng, lat: corner.lat });
}

// Map a normalized (u, v) point of the rigid rectangle to geographic coordinates. u runs
// left->right along width, v top->bottom along height; (0.5, 0.5) is the center.
export function normToLngLat(t: OverlayTransform, u: number, v: number): LatLng {
  const center = toMercator(t.center);
  const unit = center.meterInMercatorCoordinateUnits();
  const mx = (u - 0.5) * t.width * unit;
  const my = (v - 0.5) * t.height * unit;
  const angle = (t.bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ll = new maplibre.MercatorCoordinate(
    center.x + mx * cos - my * sin,
    center.y + mx * sin + my * cos,
  ).toLngLat();
  return { lat: ll.lat, lng: ll.lng };
}

// Inverse of normToLngLat: a geographic position back to the rectangle's normalized (u, v).
export function lngLatToNorm(
  t: OverlayTransform,
  lng: number,
  lat: number,
): { u: number; v: number } {
  const center = toMercator(t.center);
  const unit = center.meterInMercatorCoordinateUnits();
  const c = maplibre.MercatorCoordinate.fromLngLat({ lng, lat });
  const dx = c.x - center.x;
  const dy = c.y - center.y;
  const angle = (t.bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lx = (dx * cos + dy * sin) / unit;
  const ly = (-dx * sin + dy * cos) / unit;
  return { u: lx / t.width + 0.5, v: ly / t.height + 0.5 };
}

// Rigid transform -> 4 rectangle corners, in [TL, TR, BR, BL] order.
export function transformToCorners(transform: OverlayTransform): LatLng[] {
  return SIGN.map(([sx, sy]) => normToLngLat(transform, (sx + 1) / 2, (sy + 1) / 2));
}

// Convert 4 rectangle corners [TL, TR, BR, BL] to the rigid transform. Width and bearing come
// from the top edge, height from the left edge, center from the corner average.
export function cornersToTransform(corners: LatLng[]): OverlayTransform {
  const [tl, tr, br, bl] = corners.map(toMercator);
  /* oxlint-disable no-non-null-assertion */
  const centerMercator = new maplibre.MercatorCoordinate(
    (tl!.x + tr!.x + br!.x + bl!.x) / 4,
    (tl!.y + tr!.y + br!.y + bl!.y) / 4,
  );
  const center = centerMercator.toLngLat();
  const unit = centerMercator.meterInMercatorCoordinateUnits();

  const top = { x: tr!.x - tl!.x, y: tr!.y - tl!.y };
  const left = { x: bl!.x - tl!.x, y: bl!.y - tl!.y };
  /* oxlint-enable no-non-null-assertion */

  return {
    center: { lat: center.lat, lng: center.lng },
    width: Math.hypot(top.x, top.y) / unit,
    height: Math.hypot(left.x, left.y) / unit,
    bearing: (Math.atan2(top.y, top.x) * 180) / Math.PI,
  };
}
