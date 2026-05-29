import type { ExpressionSpecification } from "maplibre-gl";

// Shared project-shape stroke styling. Used by both the view-mode MVT layers
// (projectVectorLayers) and the edit/moderation GeoJSON layers (shapeRendering)
// so a shape renders identically across modes.

// Line width scales with zoom to avoid the "blobby" antialiasing artifact at low zoom.
export const SHAPE_LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  1,
  12,
  3,
];

// +1 wider variant for hover/selected states.
export const SHAPE_LINE_WIDTH_HOVER: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  2,
  12,
  4,
];

export const SHAPE_LONG_DASH: [number, number] = [4, 2];
export const SHAPE_SHORT_DASH: [number, number] = [0.2, 2];
