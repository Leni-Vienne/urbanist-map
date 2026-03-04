// Marker configuration constants
// Centralized location for marker opacity, timing, and behavior settings

export const MARKER_OPACITY = {
  // City marker opacity values
  city: {
    default: 0.6,
    hover: 1,
  },

  // Standalone project marker opacity values
  standalone: {
    default: 0.8,
    hover: 1,
  },

  // Overlay marker opacity values
  overlay: {
    default: 1,
    selected: 1,
  },
} as const;
