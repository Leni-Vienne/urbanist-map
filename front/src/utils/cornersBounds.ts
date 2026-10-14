import { LngLat, LngLatBounds } from "maplibre-gl";
import type { LatLng } from "@/types/index";

type NestedCoordinates = number[] | NestedCoordinates[];

// Build a maplibre LngLatBounds enclosing every corner, for camera navigation.
export function buildLngLatBounds(corners: LatLng[]): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }
  return bounds;
}

// Grow `bounds` to enclose every position of a geometry, allocating it on the first position seen.
// Returns the grown bounds, or null when `bounds` was null and the geometry held no positions.
export function extendBoundsWithGeometry(
  bounds: LngLatBounds | null,
  geometry: GeoJSON.Geometry,
): LngLatBounds | null {
  let result = bounds;
  if (geometry.type === "GeometryCollection") {
    for (const part of geometry.geometries) result = extendBoundsWithGeometry(result, part);
    return result;
  }

  const pending: NestedCoordinates[] = [geometry.coordinates];
  while (pending.length > 0) {
    const coordinates = pending.pop();
    if (!coordinates) continue;
    const [lng, lat] = coordinates;
    if (typeof lng === "number" && typeof lat === "number") {
      const position: [number, number] = [lng, lat];
      if (result) result.extend(position);
      else result = new LngLatBounds(position, position);
    } else {
      for (const child of coordinates) {
        if (Array.isArray(child)) pending.push(child);
      }
    }
  }
  return result;
}

export function buildShapeBounds(
  ...collections: (GeoJSON.GeometryCollection | null | undefined)[]
): LngLatBounds | null {
  let bounds: LngLatBounds | null = null;
  for (const collection of collections) {
    for (const geometry of collection?.geometries ?? []) {
      if (geometry.type === "Point" || geometry.type === "MultiPoint") continue;
      bounds = extendBoundsWithGeometry(bounds, geometry);
    }
  }
  return bounds;
}

/**
 * AABB intersection test: true if the bounding box of `corners` overlaps `bounds`.
 * Works on raw {lat,lng} corners to avoid allocating bounds objects per call, which
 * matters in the per-frame viewport loops. Correctly handles the case where the
 * viewport sits entirely inside a large overlay polygon.
 */
export function cornersIntersectBounds(corners: LatLng[], bounds: LngLatBounds): boolean {
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
    maxLat > bounds.getSouth() &&
    minLat < bounds.getNorth() &&
    maxLng > bounds.getWest() &&
    minLng < bounds.getEast()
  );
}
