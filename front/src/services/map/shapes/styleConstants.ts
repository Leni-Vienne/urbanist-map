import type { ExpressionSpecification } from "maplibre-gl";
import type { TimelineStatus } from "../../../../../back/src/db/schema";

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

// SVG-preview equivalents of the map dasharrays. "" renders a solid line.
export const STATUS_PREVIEW_DASHARRAY = {
  proposed: "0,5",
  planned: "7,6",
  under_construction: "7,6",
  completed: "",
  canceled: "7,6",
} satisfies Record<TimelineStatus, string>;
