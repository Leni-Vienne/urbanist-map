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

// Desktop: a selected project's anchor is flown to this fraction of the viewport height (upper
// third), leaving room below for the popup. Shared by the fly offset (mapNavigation) and the
// placement math (popupState) so the predicted anchor matches where the camera lands.
export const DESKTOP_POPUP_ANCHOR_Y_FRACTION = 0.32;

/**
 * Returns the effective zoom threshold for the current viewport.
 * Mobile screens (≤768px) display a smaller geographic area at any given zoom level,
 * so contributions are revealed one zoom level earlier to compensate.
 */
export function getEffectiveThreshold(base: number): number {
  return isMobileViewport() ? base - 1 : base;
}
