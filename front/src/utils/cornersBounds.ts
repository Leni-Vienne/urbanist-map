import { LngLat, LngLatBounds } from "maplibre-gl";
import type { LatLng } from "@/types/index";

interface SimpleBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Build a maplibre LngLatBounds enclosing every corner, for camera navigation.
export function buildLngLatBounds(corners: LatLng[]): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }
  return bounds;
}

/**
 * AABB intersection test: true if the bounding box of `corners` overlaps `bounds`.
 * Works on raw {lat,lng} corners to avoid allocating bounds objects per call, which
 * matters in the per-frame viewport loops. Correctly handles the case where the
 * viewport sits entirely inside a large overlay polygon.
 */
export function cornersIntersectBounds(corners: LatLng[], bounds: SimpleBounds): boolean {
  const first = corners[0];
  if (!first) return false;

  let minLat = first.lat;
  let maxLat = first.lat;
  let minLng = first.lng;
  let maxLng = first.lng;

  for (let i = 1; i < corners.length; i += 1) {
    const c = corners[i];
    if (!c) continue;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return (
    maxLat > bounds.south && minLat < bounds.north && maxLng > bounds.west && minLng < bounds.east
  );
}
