import maplibre from "maplibre-gl";

type Corner = { lat: number; lng: number };

// Web Mercator is undefined beyond ~±85.06°. A corner that is finite but out of range (or
// otherwise malformed) projects to Infinity inside cameraForBounds and crashes the camera, so
// bad quads are rejected before they reach marker placement, navigation, or image rendering.
const MAX_MERCATOR_LAT = 85.06;

function isValidCorner(c: Corner): boolean {
  return (
    Number.isFinite(c.lng) &&
    Number.isFinite(c.lat) &&
    Math.abs(c.lat) <= MAX_MERCATOR_LAT &&
    Math.abs(c.lng) <= 180
  );
}

export function isValidQuad(corners: Corner[] | undefined | null): corners is Corner[] {
  return corners != null && corners.length === 4 && corners.every(isValidCorner);
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

// Rigid transform -> 4 rectangle corners, in [TL, TR, BR, BL] order.
export function transformToCorners(transform: OverlayTransform): { lat: number; lng: number }[] {
  const center = toMercator(transform.center);
  const unit = center.meterInMercatorCoordinateUnits();
  const halfWidth = (transform.width / 2) * unit;
  const halfHeight = (transform.height / 2) * unit;
  const angle = (transform.bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return SIGN.map(([sx, sy]) => {
    const x = (sx ?? 0) * halfWidth;
    const y = (sy ?? 0) * halfHeight;
    const corner = new maplibre.MercatorCoordinate(
      center.x + x * cos - y * sin,
      center.y + x * sin + y * cos,
    ).toLngLat();
    return { lat: corner.lat, lng: corner.lng };
  });
}

// Best-fit a rigid rectangle to 4 arbitrary corners. Lossy for non-rectangular quads,
// which is acceptable under the rigid editing model (view mode renders raw corners instead).
export function cornersToTransform(corners: { lat: number; lng: number }[]): OverlayTransform {
  const [tl, tr, br, bl] = corners.map(toMercator);
  /* oxlint-disable no-non-null-assertion */
  const centerMercator = new maplibre.MercatorCoordinate(
    (tl!.x + tr!.x + br!.x + bl!.x) / 4,
    (tl!.y + tr!.y + br!.y + bl!.y) / 4,
  );
  const center = centerMercator.toLngLat();
  const unit = centerMercator.meterInMercatorCoordinateUnits();

  const top = { x: tr!.x - tl!.x, y: tr!.y - tl!.y };
  const bottom = { x: br!.x - bl!.x, y: br!.y - bl!.y };
  const left = { x: bl!.x - tl!.x, y: bl!.y - tl!.y };
  const right = { x: br!.x - tr!.x, y: br!.y - tr!.y };
  /* oxlint-enable no-non-null-assertion */

  return {
    center: { lat: center.lat, lng: center.lng },
    width: (Math.hypot(top.x, top.y) + Math.hypot(bottom.x, bottom.y)) / 2 / unit,
    height: (Math.hypot(left.x, left.y) + Math.hypot(right.x, right.y)) / 2 / unit,
    bearing: (Math.atan2((top.y + bottom.y) / 2, (top.x + bottom.x) / 2) * 180) / Math.PI,
  };
}
