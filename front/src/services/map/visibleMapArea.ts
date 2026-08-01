import { LngLatBounds, type Map as MaplibreMap } from "maplibre-gl";
import { getMapOrNull } from "@/services/core/map";
import { getMobileDrawerOcclusionPx } from "@/services/core/mapNavigation";
import type { MapArea } from "@/services/feed/latestContributions";

// Widest view worth filtering to, in degrees of longitude. Gating on the ground the view spans
// rather than on a zoom level keeps the threshold the same everywhere: a phone covers far less at a
// given zoom than a desktop map does, and would otherwise have to zoom in much further to qualify.
const MAX_FILTER_SPAN_DEGREES = 25;

/** The area a filter applied right now would capture, or null when no map is mounted. */
export function getVisibleMapArea(): MapArea | null {
  const target = getMapOrNull();
  if (!target) return null;
  const bounds = visibleBounds(target);
  return {
    west: normalizeLongitude(bounds.getWest()),
    south: bounds.getSouth(),
    east: normalizeLongitude(bounds.getEast()),
    north: bounds.getNorth(),
  };
}

/** Whether the view is narrow enough that bounding a query to it says anything. */
export function canFilterVisibleArea(): boolean {
  const target = getMapOrNull();
  return target !== null && longitudeSpanDegrees(target) <= MAX_FILTER_SPAN_DEGREES;
}

// The mobile drawer covers the bottom of the map, so the whole-container bounds reach well past
// what the user can see. Corners of the uncovered rectangle instead, keeping the diagonal pair
// MapLibre uses so a rotated view still yields the box that encloses it.
function visibleBounds(target: MaplibreMap): LngLatBounds {
  const container = target.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight - getMobileDrawerOcclusionPx();
  if (width <= 0 || height <= 0) return target.getBounds();
  return new LngLatBounds()
    .extend(target.unproject([0, 0]))
    .extend(target.unproject([width, 0]))
    .extend(target.unproject([width, height]))
    .extend(target.unproject([0, height]));
}

// Longitude the map container spans at its current zoom. MapLibre tiles are 512px, so the whole
// world is 512 * 2^zoom pixels wide. Read from the camera rather than differencing the bounds,
// which wrap: a view encircling the globe would otherwise report a narrow span and pass the gate.
function longitudeSpanDegrees(target: MaplibreMap): number {
  const worldWidth = 512 * 2 ** target.getZoom();
  return (target.getContainer().clientWidth / worldWidth) * 360;
}

function normalizeLongitude(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && value > 0 ? 180 : normalized;
}
