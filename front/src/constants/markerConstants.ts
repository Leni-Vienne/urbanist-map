// AI : Marker configuration constants
// AI : Centralized location for marker opacity, timing, and behavior settings

export const MARKER_OPACITY = {
  // AI : City marker opacity values
  city: {
    default: 0.6,
    hover: 1,
  },

  // AI : Standalone project marker opacity values
  standalone: {
    default: 0.8,
    hover: 1,
  },

  // AI : Country marker opacity values
  country: {
    default: 0.6,
    hover: 1,
  },

  // AI : Overlay marker opacity values
  overlay: {
    default: 1,
    selected: 1,
  },
} as const;

// AI : Marker interaction timing constants (in milliseconds)
export const MARKER_TIMING = {
  // AI : Delay for mode transition animations
  MODE_TRANSITION: 100,

  // AI : Debounce delay for filter changes
  FILTER_DEBOUNCE: 300,

  // AI : Delay for overlay render operations
  OVERLAY_RENDER: 150,

  // AI : Animation duration for popup/tooltip
  POPUP_ANIMATION: 200,
} as const;
