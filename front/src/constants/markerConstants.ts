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
