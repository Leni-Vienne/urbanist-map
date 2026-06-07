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
 * On desktop, a freshly-selected project is flown so its anchor lands at this fraction of the
 * viewport height (upper third) rather than dead-center, leaving room for the downward popup.
 * The fly offset (mapNavigation) and the popup placement math (popupState) both derive from this
 * value, so the predicted on-screen anchor matches where the camera actually lands. Lives here,
 * in a leaf constants module, so neither of those sibling modules has to import the other.
 */
export const DESKTOP_POPUP_ANCHOR_Y_FRACTION = 0.32;

/**
 * Returns the effective zoom threshold for the current viewport.
 * Mobile screens (≤768px) display a smaller geographic area at any given zoom level,
 * so contributions are revealed one zoom level earlier to compensate.
 */
export function getEffectiveThreshold(base: number): number {
  return isMobileViewport() ? base - 1 : base;
}
