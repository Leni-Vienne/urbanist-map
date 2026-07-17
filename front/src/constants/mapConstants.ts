import { isMobile } from "@/services/core/viewport";

// All thresholds are native MapLibre zoom levels.
export const MAP_CONFIG = {
  // For switching to country specific satellite layers
  MIN_ZOOM_FOR_COUNTRY_LAYERS: 7,

  // Minimum zoom at which overlay content exists on the map: the raster images, the footprint
  // tile layers, the edit handles, and the status markers of edit/moderation mode. Below it the
  // map shows project points/shapes only.
  MIN_ZOOM_FOR_OVERLAYS: 13,
} as const;

/**
 * Returns the effective zoom threshold for the current viewport.
 * Mobile screens (≤768px) display a smaller geographic area at any given zoom level,
 * so contributions are revealed one zoom level earlier to compensate.
 */
export function getEffectiveThreshold(base: number): number {
  return isMobile.value ? base - 1 : base;
}
