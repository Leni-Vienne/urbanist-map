import type { ExpressionSpecification } from "maplibre-gl";

// Shared project-shape stroke styling. Used by both the view-mode MVT layers and the
// edit/moderation GeoJSON layers so a shape renders identically across modes.

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

// SVG-preview equivalents of the map dasharrays, keyed by timeline status, for the 28×10
// line previews (stroke-width 2.5, round linecap) in FilterControl and CurrentLocationPanel.
// "" renders a solid line. Keys are TimelineStatus values.
export const STATUS_PREVIEW_DASHARRAY: Record<string, string> = {
  proposed: "0,5",
  planned: "7,6",
  under_construction: "7,6",
  completed: "",
  canceled: "7,6",
};
