import { isMobileViewport } from "@/composables/ui/useIsMobile";

// All thresholds are native MapLibre zoom levels.
export const MAP_CONFIG = {
  // Minimum zoom level to start loading viewport data and showing markers
  // Lower than MIN_ZOOM_FOR_OVERLAYS to show markers before full images
  VIEWPORT_LOAD_THRESHOLD: 12,

  // For switching to country specific satellite layers
  MIN_ZOOM_FOR_COUNTRY_LAYERS: 7,

  // Minimum zoom level required to display actual overlay images (vs just markers)
  // This is higher than VIEWPORT_LOAD_THRESHOLD for progressive loading
  MIN_ZOOM_FOR_OVERLAYS: 13,
} as const;

/**
 * Returns the effective zoom threshold for the current viewport.
 * Mobile screens (≤768px) display a smaller geographic area at any given zoom level,
 * so contributions are revealed one zoom level earlier to compensate.
 */
export function getEffectiveThreshold(base: number): number {
  return isMobileViewport() ? base - 1 : base;
}
