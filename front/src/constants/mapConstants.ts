// AI : Map configuration constants
// AI : Centralized location for map-related magic numbers and thresholds

export const MAP_CONFIG = {
  // AI : Minimum zoom level to start loading city data and showing overlay markers
  // AI : This is lower than MIN_ZOOM_FOR_OVERLAYS to show markers before full images
  VIEWPORT_LOAD_THRESHOLD: 13,

  // For switching to country specific satellite layers
  MIN_ZOOM_FOR_COUNTRY_LAYERS: 8,

  // AI : Minimum zoom level required to display actual overlay images (vs just markers)
  // AI : This is higher than VIEWPORT_LOAD_THRESHOLD for progressive loading
  MIN_ZOOM_FOR_OVERLAYS: 14,
} as const;

/**
 * Returns the effective zoom threshold for the current viewport.
 * Mobile screens (≤768px) display a smaller geographic area at any given zoom level,
 * so contributions are revealed one zoom level earlier to compensate.
 */
export function getEffectiveThreshold(base: number): number {
  return globalThis.innerWidth <= 768 ? base - 1 : base;
}
