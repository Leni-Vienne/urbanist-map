// AI : Map configuration constants
// AI : Centralized location for map-related magic numbers and thresholds

export const MAP_CONFIG = {
  // AI : Minimum zoom level to start loading city data and showing overlay markers
  // AI : This is lower than MIN_ZOOM_FOR_OVERLAYS to show markers before full images
  VIEWPORT_LOAD_THRESHOLD: 13,

  // AI : Minimum zoom level required to display actual overlay images (vs just markers)
  // AI : This is higher than VIEWPORT_LOAD_THRESHOLD for progressive loading
  MIN_ZOOM_FOR_OVERLAYS: 14,

  // AI : Cache duration in milliseconds for various data types
  CACHE_DURATION_MS: 5 * 60 * 1000, // 5 minutes

  // AI : Threshold for determining if a location is "nearby" (in degrees, roughly ~11km at equator)
  NEARBY_LOCATION_THRESHOLD: 0.1,

  // AI : Minimum zoom level for showing country markers with animation
  MIN_ZOOM_ANIMATION_LEVEL: 11,
} as const;
