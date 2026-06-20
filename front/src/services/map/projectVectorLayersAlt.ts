import type {
  Map as MaplibreMap,
  MapMouseEvent,
  PointLike,
  FilterSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import { map } from "@/services/core/map";
import { getEffectiveThreshold } from "@/constants/mapConstants";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import {
  getCurrentHighlightedProjectId,
  handleBackgroundClick,
  selectOverlay,
} from "@/services/overlay/selection";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { watch } from "vue";

import {
  getExternalHoverId,
  getExternalHoverOverlayId,
  registerExternalHoverCallback,
  setExternalHover,
} from "@/services/map/vectorHoverState";
import {
  triggerProjectHover,
  triggerClusterHover,
  clearHoverPreview,
  updateHoverPreviewPosition,
  type HoverProjectData,
  type ClusterTagCount,
} from "@/services/map/hoverPreviewState";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";
import {
  SHAPE_LINE_WIDTH,
  SHAPE_LINE_WIDTH_HOVER,
  SHAPE_LONG_DASH,
  SHAPE_SHORT_DASH,
} from "@/services/map/shapeStyleConstants";
import {
  selectedProjectTags,
  selectedStatusFilters,
  splitTagSelection,
  UNTAGGED_PROJECT_FILTER,
  getNameFilterMode,
  sizeFilterRange,
  lastModifiedDateRange,
  showOnlyWithImages,
} from "@/services/map/filters";

/* oxlint-disable no-unsafe-type-assertion */ // disabled because maplibre-gl is clunky to type
// Alternative map style, selected per session in projectVectorLayersDispatch.ts. Diverged from the
// default (projectVectorLayers.ts): grid-cell clustering with quality scoring plus a hover preview
// card. Reads its own backend endpoint (projects-alt) so the data can diverge too.
const TILE_URL = `${getApiUrl()}/api/tiles/projects-alt/{z}/{x}/{y}`;

// ── Zoom level constants (native MapLibre zoom) ─────────────────────────────
/** Source/layer minzoom for project points. Per-zoom thinning is done server-side via the
 *  quality-score gate in tiles-alt.sql, so this stays at 0. */
const PROJECT_POINTS_MIN_ZOOM = 0;
/** Zoom level at which project shapes (MVT) become visible.
 *  Large shapes appear earlier via getShapeZoomVisibilityFilter, see that function for the full table. */
const PROJECT_SHAPES_MIN_ZOOM = 3;
/** Base zoom level at which overlay footprints and point geometries become visible.
 *  Wrapped in getEffectiveThreshold per layer so mobile reveals one level earlier,
 *  matching the raster overlay images. */
const OVERLAY_FOOTPRINTS_MIN_ZOOM = 13;
/** Max zoom for MVT tile source */
const MVT_SOURCE_MAX_ZOOM = 14;

// ── Line styling constants ──────────────────────────────────────────────────
// Overlay footprints use double width because half the stroke is covered by the overlay image.
// They only render at z12+, where the old zoom ramp had already reached its max, so width is flat.
const FOOTPRINT_LINE_WIDTH = 2;

// ── Interaction constants ───────────────────────────────────────────────────
const VECTOR_HOVER_HIT_RADIUS_PX = 6;
const HOVER_NONE_ID = "__none__";
// Clicking a cluster marker zooms in by this many levels to spread its grid cell apart (the
// conventional "expand cluster" gesture). No detail opens, since a cluster has no single project.
const CLUSTER_EXPAND_ZOOM_STEP = 2;

export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints-fill",
  "project-shapes-fill",
  "project-shapes-proposed-fill",
  "project-shapes",
  "project-shapes-completed",
  "project-shapes-proposed-dashed",
] as const;

const CLICK_QUERY_LAYERS = [
  ...VECTOR_QUERY_LAYERS,
  "project-points",
  "pending-project-points",
] as const;

type RenderedMapFeature = {
  properties?: Record<string, unknown>;
  sourceLayer?: string;
  geometry?: {
    coordinates?: any;
  };
  layer?: {
    id: string;
  };
  id?: string | number;
};

const DEFAULT_PROJECT_LINE_COLOR = "#7ea2b7";

// Cluster markers (cell_count > 1) aggregate many projects, so a tag color would just be the tag of
// whichever project won the representative slot, misleading at the cluster level. They render in this
// neutral slate instead; tag color is reserved for lone markers (cell_count == 1), where it is honest.
const CLUSTER_NEUTRAL_COLOR = "#64748b";

const PROJECT_LINE_COLOR_BY_TAG: Record<string, string> = {};

for (const tag of PROJECT_TAGS) {
  PROJECT_LINE_COLOR_BY_TAG[tag.slug] = tag.color;
}

function getTagColorExpression(tagExpression: unknown[]): ExpressionSpecification {
  const expression: unknown[] = [
    "match",
    ["downcase", ["to-string", ["coalesce", ...tagExpression, ""]]],
  ];
  for (const [tag, color] of Object.entries(PROJECT_LINE_COLOR_BY_TAG)) {
    expression.push(tag, color);
  }
  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression as ExpressionSpecification;
}

function getProjectLineColorExpression(): ExpressionSpecification {
  return getTagColorExpression([["get", "first_tag"]]);
}

// Per-cluster count of a single tag, read from the count_<tag> property the tile bakes in (0 when
// absent). Used to find the most numerous selected tag in a cluster.
function getTagCountExpression(tag: string): ExpressionSpecification {
  return ["coalesce", ["get", `count_${tag}`], 0] as ExpressionSpecification;
}

function getProjectPointColorExpression(): ExpressionSpecification {
  const loneColor = getTagColorExpression([["get", "first_tag"]]);

  // Clusters are neutral by default. When a tag filter is active, a cluster adopts the color of the
  // most numerous selected tag it contains, compared via the per-tag counts (count_<tag>). A tag
  // wins when its count is >= every other selected tag's; the case chain is built in reverse so ties
  // break toward the tag listed first in the selection.
  let clusterColor: ExpressionSpecification | string = CLUSTER_NEUTRAL_COLOR;
  const { knownTags } = splitTagSelection();
  for (let i = knownTags.length - 1; i >= 0; i -= 1) {
    const tag = knownTags[i];
    if (tag === undefined) continue;
    const tagColor = PROJECT_LINE_COLOR_BY_TAG[tag] || DEFAULT_PROJECT_LINE_COLOR;

    const isMax: unknown[] = ["all"];
    for (const other of knownTags) {
      if (other === undefined || other === tag) continue;
      isMax.push([">=", getTagCountExpression(tag), getTagCountExpression(other)]);
    }
    // A lone selected tag has nothing to compare against, so it always wins its cluster.
    const winsCondition = isMax.length === 1 ? true : (isMax as ExpressionSpecification);

    clusterColor = ["case", winsCondition, tagColor, clusterColor] as ExpressionSpecification;
  }

  return [
    "case",
    [">", ["get", "cell_count"], 1],
    clusterColor,
    loneColor,
  ] as ExpressionSpecification;
}

// Cluster count label. With no tag filter it shows the raw cell total. With a tag filter active it
// sums the per-tag counts the tile bakes in (count_<tag> / count_untagged), capped at cell_count
// since a project carrying two selected tags is counted in each, so the bare sum can overshoot.
function getClusterCountExpression(): ExpressionSpecification {
  const { includeUntagged, knownTags } = splitTagSelection();
  if (knownTags.length === 0 && !includeUntagged) {
    return ["to-string", ["get", "cell_count"]] as ExpressionSpecification;
  }

  const columns = knownTags.map((tag) => `count_${tag}`);
  if (includeUntagged) columns.push("count_untagged");

  const sum: unknown[] = ["+"];
  for (const col of columns) sum.push(["coalesce", ["get", col], 0]);
  // "+" needs at least two operands; pad a single selected tag with a zero.
  if (columns.length === 1) sum.push(0);

  return [
    "to-string",
    ["min", sum as ExpressionSpecification, ["get", "cell_count"]],
  ] as ExpressionSpecification;
}

// Circle radius for project-points: lone markers stay small; cluster markers (cell_count > 1) step
// up only when the count gains a digit (10, 100, 1000), so the circle hugs the label tightly at
// every magnitude instead of ballooning with the raw count.
// `hovered` adds a small bump applied to both via the hover/selected case in the layer paint.
function getPointRadiusExpression(hovered: boolean): ExpressionSpecification {
  const bump = hovered ? 2 : 0;
  // Radius tracks the label's digit count: 1 digit → 6, 2 → 8, 3 → 10, 4+ → 13. Each tier is the
  // tightest circle that contains the 10px bold count without clipping its corners.
  return [
    "case",
    [">", ["get", "cell_count"], 1],
    ["step", ["get", "cell_count"], 6 + bump, 10, 8 + bump, 100, 10 + bump, 1000, 13 + bump],
    4 + bump,
  ] as ExpressionSpecification;
}

// True when the feature carries the cursor "hover" state or the pinned "selected" state. Hover and
// selected are tracked as two independent feature-state keys (see setCursorHoverState /
// setSelectedHoverState) so a click-pinned project stays lit even after the cursor moves away.
function hoverOrSelectedCondition(): ExpressionSpecification {
  return [
    "any",
    ["boolean", ["feature-state", "hover"], false],
    ["boolean", ["feature-state", "selected"], false],
  ] as ExpressionSpecification;
}

// Paint-value expression that switches to hoverValue when the feature is hovered or selected.
// Lets the base layer carry its own highlight in place (one repaint) instead of toggling a separate
// hover layer with setFilter (which reloads every visible tile).
// For zoom-interpolated values (e.g. line-width) use mergeZoomHoverState instead: wrapping two
// interpolate expressions in a "case" is rejected (only one zoom curve allowed per expression).
function withHoverState(
  baseValue: ExpressionSpecification | number | string,
  hoverValue: ExpressionSpecification | number | string,
): ExpressionSpecification {
  return ["case", hoverOrSelectedCondition(), hoverValue, baseValue] as ExpressionSpecification;
}

// Merge two ["interpolate", ["linear"], ["zoom"], z, v, ...] expressions (identical zoom stops)
// into a single zoom curve whose stop outputs switch on the hover/selected state. Keeps the lone
// permitted zoom curve at the top level while still folding the highlight in via feature-state.
function mergeZoomHoverState(
  base: ExpressionSpecification,
  hover: ExpressionSpecification,
): ExpressionSpecification {
  const merged: unknown[] = base.slice(0, 3); // ["interpolate", ["linear"], ["zoom"]]
  for (let i = 3; i < base.length; i += 2) {
    merged.push(base[i], ["case", hoverOrSelectedCondition(), hover[i + 1], base[i + 1]]);
  }
  return merged as ExpressionSpecification;
}

/**
 * Zoom-dependent size gate for the project-shapes layer.
 * Mirrors the server-side logic in tiles-alt.sql (all values are native MapLibre zoom):
 *   z13+ → all shapes
 *   z12  → geometry_size_m >= 50 m
 *   z11  → geometry_size_m >= 100 m
 *   z10  → geometry_size_m >= 200 m
 *   z9   → geometry_size_m >= 500 m
 *   z8   → geometry_size_m >= 1 km
 *   z7   → geometry_size_m >= 10 km
 *   z5   → geometry_size_m >= 50 km
 *   z4   → geometry_size_m >= 100 km
 * Projects with null geometry_size_m (point stand-ins) are never shown via this filter.
 */
function getShapeZoomVisibilityFilter(): FilterSpecification {
  return [
    ">=",
    ["coalesce", ["get", "geometry_size_m"], 0],
    [
      "step",
      ["zoom"],
      100_000,
      5,
      50_000,
      7,
      10_000,
      8,
      1000,
      9,
      500,
      10,
      200,
      11,
      100,
      12,
      50,
      13,
      0,
    ],
  ] as FilterSpecification;
}

const isProposedFilterExpression: FilterSpecification = [
  "==",
  ["get", "timeline_status"],
  "proposed",
];

const isCompletedFilterExpression: FilterSpecification = [
  "==",
  ["get", "timeline_status"],
  "completed",
];

const isNeitherProposedNorCompletedFilterExpression: FilterSpecification = [
  "all",
  ["!=", ["get", "timeline_status"], "proposed"],
  ["!=", ["get", "timeline_status"], "completed"],
];

/**
 * Build a MapLibre filter expression based on current tag selection.
 * Returns null if no filtering is needed (all tags visible).
 */
function getTagFilterExpression(): FilterSpecification | null {
  if (selectedProjectTags.value.length === 0) {
    return null; // No filter needed
  }

  const { includeUntagged, knownTags } = splitTagSelection();

  const conditions: unknown[] = [];

  // Match any of the selected known tags. The backend sends 'tags' as a JSON array string in the tiles.
  for (const tag of knownTags) {
    conditions.push([
      "case",
      ["has", "cluster_tags"],
      ["in", `,${tag},`, ["to-string", ["get", "cluster_tags"]]],
      ["in", tag, ["to-string", ["get", "tags"]]],
    ]);
  }

  // Match untagged (empty first_tag)
  if (includeUntagged) {
    conditions.push(["==", ["to-string", ["get", "first_tag"]], ""]);
  }

  if (conditions.length === 0) {
    // Only untagged was selected but we didn't add it, show nothing
    return ["==", ["to-string", ["get", "id"]], "__none__"] as FilterSpecification; // Always false
  }

  if (conditions.length === 1) {
    return conditions[0] as FilterSpecification;
  }

  return ["any", ...conditions] as FilterSpecification;
}

// Layers with existing filters that need tag filter merged with "all"
const LAYERS_WITH_EXISTING_FILTERS: Record<string, () => FilterSpecification> = {
  // project-shapes sub-layers: each combines a status filter with the zoom+size visibility gate
  // so that large projects appear at lower zoom levels (z6/z7) while small ones wait until z8+.
  "project-shapes": () =>
    [
      "all",
      isNeitherProposedNorCompletedFilterExpression,
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
  "project-shapes-completed": () =>
    ["all", isCompletedFilterExpression, getShapeZoomVisibilityFilter()] as FilterSpecification,
  "project-shapes-fill": () =>
    [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      ["!=", ["get", "timeline_status"], "proposed"],
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
  "project-shapes-proposed-fill": () =>
    [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      isProposedFilterExpression,
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
  "project-shapes-proposed-dashed": () =>
    ["all", isProposedFilterExpression, getShapeZoomVisibilityFilter()] as FilterSpecification,
  // Solid hover overlay: every dashed shape (non-completed), gated to the same zoom visibility.
  "project-shapes-hover-solid": () =>
    [
      "all",
      ["!=", ["get", "timeline_status"], "completed"],
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
};

/**
 * Build a MapLibre filter expression based on current timeline status selection.
 */
function getStatusFilterExpression(): FilterSpecification | null {
  // Empty selection = all visible, no filter needed
  if (selectedStatusFilters.value.length === 0) return null;

  // If the cluster has aggregated statuses, check if any match.
  // Otherwise, fall back to the representative timeline_status.
  const clusterConditions: unknown[] = selectedStatusFilters.value.map((status) => [
    "in",
    `,${status},`,
    ["to-string", ["get", "cluster_statuses"]],
  ]);

  const expression: unknown[] = [
    "case",
    ["has", "cluster_statuses"],
    ["any", ...clusterConditions],
    ["in", ["get", "timeline_status"], ["literal", selectedStatusFilters.value]],
  ];
  return expression as FilterSpecification;
}

/**
 * Build a size filter expression for the project-points layer.
 * Checks against min_size_m/max_size_m which reflect the full grid cell, not just the representative.
 * Returns null if the size filter is at its default (no filtering needed).
 */
function getSizeFilterExpressionForPoints(): FilterSpecification | null {
  const [minSize, maxSize] = sizeFilterRange.value;
  if (minSize === 0 && maxSize === Infinity) return null;

  // A cell matches if its size range overlaps the filter range.
  const conditions: unknown[] = [[">=", ["coalesce", ["get", "max_size_m"], 0], minSize]];
  if (maxSize !== Infinity) {
    conditions.push(["<=", ["coalesce", ["get", "min_size_m"], 0], maxSize]);
  }
  const rangeFilter = allOf(conditions);
  // Cells of only no-geometry projects have null max_size_m; let them pass like the shapes filter,
  // otherwise the default min size would hide every standalone/overlay-only project.
  return ["any", ["==", ["get", "max_size_m"], null], rangeFilter] as FilterSpecification;
}

/**
 * Build a size filter expression for the project-shapes layer.
 * Standalone shape-points with missing geometry_size_m pass through the size filter.
 */
function getSizeFilterExpressionForShapes(): FilterSpecification | null {
  const [minSize, maxSize] = sizeFilterRange.value;
  if (minSize === 0 && maxSize === Infinity) return null;

  // Allow missing geometry_size_m to pass through the size filter. (for projects with no geometry)
  const conditions: unknown[] = [[">=", ["get", "geometry_size_m"], minSize]];
  if (maxSize !== Infinity) {
    conditions.push(["<=", ["get", "geometry_size_m"], maxSize]);
  }

  const rangeFilter = allOf(conditions);
  return ["any", ["==", ["get", "geometry_size_m"], null], rangeFilter] as FilterSpecification;
}

/**
 * Build a filter expression keeping only features that have an approved overlay image.
 * Returns null when the image filter is off. The tile carries has_image as a boolean on
 * both the project-points (aggregated over the cluster) and project-shapes layers.
 */
function getImageFilterExpression(): FilterSpecification | null {
  if (!showOnlyWithImages.value) return null;
  return ["==", ["get", "has_image"], true] as FilterSpecification;
}

/**
 * Build a name filter expression. Returns null if no name filter is active.
 */
function getNameFilterExpression(): FilterSpecification | null {
  const mode = getNameFilterMode();
  if (mode === "all") return null;
  return ["==", ["get", "is_named"], mode === "named" ? 1 : 0] as FilterSpecification;
}

/**
 * Build a last modified date filter expression for the project-points layer.
 * Checks against min_last_modified_s/max_last_modified_s which reflect the full grid cell,
 * not just the representative, so clusters are only hidden when no project in the cell matches.
 * Returns null if filter is at its default.
 * The tile properties are in Unix seconds.
 */
function getLastModifiedDateFilterExpression(): FilterSpecification | null {
  const [minMs, maxMs] = lastModifiedDateRange.value;
  if (minMs === 0 && maxMs === Infinity) return null;

  const minS = Math.floor(minMs / 1000);
  // A cell matches if its date range overlaps the filter range.
  const conditions: unknown[] = [
    [">=", ["coalesce", ["get", "max_last_modified_s"], ["get", "last_modified_s"]], minS],
  ];
  if (maxMs !== Infinity) {
    conditions.push([
      "<=",
      ["coalesce", ["get", "min_last_modified_s"], ["get", "last_modified_s"]],
      Math.floor(maxMs / 1000),
    ]);
  }
  return allOf(conditions);
}

// Combine raw filter conditions with "all", unwrapping the single-condition case so the
// expression stays flat (MapLibre handles both, but flat is easier to read when debugging).
function allOf(conditions: unknown[]): FilterSpecification {
  return (conditions.length === 1 ? conditions[0] : ["all", ...conditions]) as FilterSpecification;
}

function combineFilters(...filters: (FilterSpecification | null)[]): FilterSpecification | null {
  const active = filters.filter((f): f is FilterSpecification => f !== null);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0] ?? null;
  return ["all", ...active] as FilterSpecification;
}

// map.setFilter forces a full map repaint on every call, even when the new filter equals the
// current one (MapLibre only short-circuits the style mutation, not the repaint). Re-applying the
// hover filters on each mousemove therefore repaints the whole map for nothing. Skip the call when
// the filter is unchanged so an unchanged hover state costs zero repaints.
// Cleared in addProjectDataToMlMap, since a style switch recreates the layers with default filters.
const appliedLayerFilters = new Map<string, string>();

function setLayerFilter(
  mlMap: MaplibreMap,
  layerId: string,
  filter: FilterSpecification | null | undefined,
): void {
  const serialized = JSON.stringify(filter ?? null);
  if (appliedLayerFilters.get(layerId) === serialized) return;
  appliedLayerFilters.set(layerId, serialized);
  mlMap.setFilter(layerId, filter ?? undefined);
}

/**
 * Apply current tag, status, and size filters to all project vector layers.
 * Called when any filter selection changes.
 */
export function applyTagFiltersToVectorLayers(mlMap: MaplibreMap): void {
  const tagFilter = getTagFilterExpression();
  const statusFilter = getStatusFilterExpression();
  const nameFilter = getNameFilterExpression();
  const dateFilter = getLastModifiedDateFilterExpression();
  const imageFilter = getImageFilterExpression();
  const baseFilter = combineFilters(tagFilter, statusFilter, nameFilter, dateFilter, imageFilter);

  const pointsFilter = combineFilters(baseFilter, getSizeFilterExpressionForPoints());

  // project-points: tag + status + point size
  if (mlMap.getLayer("project-points")) {
    setLayerFilter(mlMap, "project-points", pointsFilter);
    mlMap.setPaintProperty("project-points", "circle-color", getProjectPointColorExpression());
  }

  // Cluster counts ride the same filters as the points, gated to cluster markers (cell_count > 1)
  // so a count never lingers when its dot is filtered out or the points layer is toggled off.
  if (mlMap.getLayer("project-points-count")) {
    const countFilter = combineFilters(
      [">", ["get", "cell_count"], 1] as FilterSpecification,
      pointsFilter,
    );
    setLayerFilter(mlMap, "project-points-count", countFilter);
    mlMap.setLayoutProperty("project-points-count", "text-field", getClusterCountExpression());
  }

  // Layers with existing filters that must be merged
  for (const [layerId, getBaseLayerFilter] of Object.entries(LAYERS_WITH_EXISTING_FILTERS)) {
    if (!mlMap.getLayer(layerId)) continue;

    const baseLayerFilter = getBaseLayerFilter();
    // All entries here are project-shapes sub-layers, so they share the shapes size filter.
    const sizeFilter = getSizeFilterExpressionForShapes();
    const merged = combineFilters(baseLayerFilter, baseFilter, sizeFilter);
    setLayerFilter(mlMap, layerId, merged ?? baseLayerFilter);
  }

  applyFootprintLayerFilters(mlMap);
}

function queryFeaturesAtPoint(
  point: { x: number; y: number },
  mlMap: MaplibreMap,
  layers: readonly string[],
  hitRadius: number,
): any[] {
  const existingLayers = layers.filter((l) => mlMap.getLayer(l));
  if (existingLayers.length === 0) return [];

  if (hitRadius > 0) {
    const bbox: [PointLike, PointLike] = [
      [point.x - hitRadius, point.y - hitRadius],
      [point.x + hitRadius, point.y + hitRadius],
    ];
    return mlMap.queryRenderedFeatures(bbox, { layers: existingLayers });
  }

  return mlMap.queryRenderedFeatures([point.x, point.y], { layers: existingLayers });
}

// Build a MapLibre filter matching features whose "id" is NOT in the hidden set.
function buildHiddenIdExclusionFilter(hiddenIds: string[]): FilterSpecification {
  return ["!", ["in", ["to-string", ["get", "id"]], ["literal", hiddenIds]]] as FilterSpecification;
}

let hiddenOverlayIdsCache: string[] = [];

function computeHiddenOverlayIds(): string[] {
  const store = useOverlayStore();
  const hidden = new Set<string>();
  // Hide the selected overlay's static footprint only in edit mode, where edit handles draw their
  // own outline and the image may be dragged off its DB position. In view/moderation there are no
  // edit handles, so keeping the outline is what gives the image its permanent border (otherwise it
  // vanishes once the cursor leaves and the hover border clears).
  if (store.idSelectedOverlay && useMapStore().mode === "edit") {
    hidden.add(store.idSelectedOverlay);
  }
  for (const [id, o] of Object.entries(store.overlays)) {
    if (o.isModified) hidden.add(id);
  }
  return [...hidden];
}

function getHiddenOverlayIds(): string[] {
  return hiddenOverlayIdsCache;
}

let isHiddenOverlaysWatcherInitialized = false;

// Footprint border/fill filter: locally hidden/edited overlays + the status and date filters
// (kept in sync with the images, which vectorTileSync status/date-filters separately).
function applyFootprintLayerFilters(mlMap: MaplibreMap): void {
  const hiddenIds = getHiddenOverlayIds();
  const hiddenFilter = hiddenIds.length > 0 ? buildHiddenIdExclusionFilter(hiddenIds) : null;
  const merged = combineFilters(
    hiddenFilter,
    getStatusFilterExpression(),
    getLastModifiedDateFilterExpression(),
  );

  for (const layerId of ["overlay-footprints-outline", "overlay-footprints-fill"]) {
    if (mlMap.getLayer(layerId)) {
      setLayerFilter(mlMap, layerId, merged ?? undefined);
    }
  }
}

function initHiddenOverlaysWatcher(): void {
  if (isHiddenOverlaysWatcherInitialized) return;
  isHiddenOverlaysWatcherInitialized = true;

  // Watch a canonical string key (not the array) so the callback only fires when the hidden-id
  // SET actually changes, instead of on every reactive read that rebuilds an identical array.
  watch(
    () => computeHiddenOverlayIds().toSorted().join("|"),
    (key) => {
      hiddenOverlayIdsCache = key ? key.split("|") : [];
      const mlMap = map.value;
      if (!mlMap) return;
      applyFootprintLayerFilters(mlMap);
    },
  );
}

const VECTOR_SOURCE = "project-sources";
const PENDING_POINTS_SOURCE = "pending-project-points-source";

// Per "source|sourceLayer|stateKey", the set of feature ids that currently carry that state.
// Lets each update be a minimal diff (setFeatureState for newly-active ids, removeFeatureState for
// the ones that dropped out) instead of re-asserting every id. setFeatureState repaints the already
// parsed tiles in place, so hover no longer reloads the visible tiles the way setFilter did.
// Cleared in addProjectDataToMlMap, since a style switch recreates the sources from scratch.
const appliedFeatureStates = new Map<string, Set<string>>();

function featureStateTarget(
  source: string,
  sourceLayer: string | undefined,
  id: string,
): { source: string; sourceLayer?: string; id: string } {
  return sourceLayer ? { source, sourceLayer, id } : { source, id };
}

function diffFeatureState(
  mlMap: MaplibreMap,
  source: string,
  sourceLayer: string | undefined,
  stateKey: "hover" | "selected",
  nextIds: Set<string>,
): void {
  const trackingKey = `${source}|${sourceLayer ?? ""}|${stateKey}`;
  const prev = appliedFeatureStates.get(trackingKey) ?? new Set<string>();
  for (const id of nextIds) {
    if (!prev.has(id)) {
      mlMap.setFeatureState(featureStateTarget(source, sourceLayer, id), { [stateKey]: true });
    }
  }
  for (const id of prev) {
    if (!nextIds.has(id)) {
      mlMap.removeFeatureState(featureStateTarget(source, sourceLayer, id), stateKey);
    }
  }
  appliedFeatureStates.set(trackingKey, nextIds);
}

// Collect ids into a set, dropping empties and the "no hover" sentinel.
function idSet(...ids: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const id of ids) {
    if (id && id !== HOVER_NONE_ID) set.add(id);
  }
  return set;
}

// Cursor-driven highlight, replaced wholesale on each mousemove. Hovering a footprint also lights
// its parent project's shape (project_id), matching the previous setFilter behaviour.
function setCursorHoverState(
  mlMap: MaplibreMap,
  vectorFeature: RenderedMapFeature | null,
  pointId: string | number | null,
): void {
  let shapeId: string | null = null;
  let overlayId: string | null = null;
  if (vectorFeature) {
    if (vectorFeature.sourceLayer === "overlay-footprints") {
      shapeId = getFeaturePropertyAsString(vectorFeature, "project_id") || null;
      overlayId = getFeaturePropertyAsString(vectorFeature, "id") || null;
    } else {
      shapeId = getFeaturePropertyAsString(vectorFeature, "id") || null;
    }
  }

  const footprintIds = idSet(overlayId);
  for (const hidden of getHiddenOverlayIds()) footprintIds.delete(hidden);

  const pointIds = idSet(pointId !== null ? String(pointId) : null);

  diffFeatureState(mlMap, VECTOR_SOURCE, "project-shapes", "hover", idSet(shapeId));
  diffFeatureState(mlMap, VECTOR_SOURCE, "overlay-footprints", "hover", footprintIds);
  diffFeatureState(mlMap, VECTOR_SOURCE, "project-points", "hover", pointIds);
  diffFeatureState(mlMap, PENDING_POINTS_SOURCE, undefined, "hover", pointIds);
}

// Pinned/external highlight (selected overlay, open project detail, sidebar card, detail pin).
// Tracked under its own "selected" key so it survives mousemove/mouseout independent of the cursor.
function setSelectedHoverState(mlMap: MaplibreMap): void {
  const selectedProjectIds = idSet(getCurrentHighlightedProjectId(), getExternalHoverId());

  const overlayIds = idSet(getExternalHoverOverlayId());
  for (const hidden of getHiddenOverlayIds()) overlayIds.delete(hidden);

  diffFeatureState(mlMap, VECTOR_SOURCE, "project-shapes", "selected", selectedProjectIds);
  diffFeatureState(mlMap, VECTOR_SOURCE, "overlay-footprints", "selected", overlayIds);
  diffFeatureState(mlMap, VECTOR_SOURCE, "project-points", "selected", selectedProjectIds);
  diffFeatureState(mlMap, PENDING_POINTS_SOURCE, undefined, "selected", selectedProjectIds);
}

function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

function handleVectorFeatureClick(feature: RenderedMapFeature): void {
  const sourceLayer = String(feature.sourceLayer);
  const isFootprint = sourceLayer === "overlay-footprints";
  const projectId = isFootprint
    ? getFeaturePropertyAsString(feature, "project_id")
    : getFeaturePropertyAsString(feature, "id");

  if (projectId.length === 0) {
    return;
  }
  // A clicked feature is on-screen by definition: desktop docks the detail in a side column beside
  // the map, mobile shows it in a persistent bottom sheet the tap came through. Neither covers the
  // tapped feature, so the camera stays put on both, which lets features be clicked in rapid
  // succession to read each one. Only cluster expansion (handlePointFeatureClick) moves the camera.

  // Pin the vector highlight immediately so mousemove cannot clear it during the
  // async project fetch that happens inside handleProjectClickFromTile.
  setExternalHover(projectId);

  if (isFootprint) {
    const overlayId = getFeaturePropertyAsString(feature, "id");
    if (overlayId) {
      selectOverlay(overlayId);
    }
  } else {
    void handleProjectClickFromTile(projectId);
  }
}

async function handlePointFeatureClick(pointFeature: RenderedMapFeature): Promise<void> {
  const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
  if (projectId.length === 0) return;

  const props: Record<string, unknown> = pointFeature.properties ?? {};
  const coordinates = pointFeature.geometry?.coordinates;
  const hasCoords = Array.isArray(coordinates) && coordinates.length >= 2;
  const [lng, lat] = hasCoords ? coordinates : [0, 0];

  // Cluster marker (drawn larger with a count): zoom in to spread the cell apart, the conventional
  // expand gesture, and open no detail since a cluster has no single project.
  const cellCount = Number(props.cell_count ?? 1);
  if (hasCoords && cellCount > 1) {
    mobileAwareFlyTo([lat, lng], map.value.getZoom() + CLUSTER_EXPAND_ZOOM_STEP);
    return;
  }

  // Lone marker: open its detail. The marker is on-screen (the tap came through), so the camera
  // stays put on both platforms, matching shape/footprint clicks.
  await handleProjectClickFromTile(projectId);
}

export function registerHybridInteractionHandlers(mlMapGetter: () => MaplibreMap | null): void {
  registerExternalHoverCallback(() => {
    const mlMap = mlMapGetter();
    if (mlMap) setSelectedHoverState(mlMap);
  });

  // queryRenderedFeatures is synchronous and walks MapLibre's internal feature tree.
  // mousemove fires at up to 500+/sec, which would saturate the main thread.
  // Throttling to ~30fps caps the cost to ~8ms/s instead of ~460ms/s.
  // Position updates are exempt from throttling so the card follows the cursor smoothly.
  let hoverThrottlePending = false;

  map.value.on("mousemove", (event: MapMouseEvent) => {
    const orig = event.originalEvent;
    if ("pointerType" in orig && (orig as PointerEvent).pointerType === "touch") {
      return;
    }

    const clientX = orig.clientX;
    const clientY = orig.clientY;

    // Always update card position immediately, bypasses Vue render via direct DOM write.
    updateHoverPreviewPosition(clientX, clientY);

    if (hoverThrottlePending) return;
    hoverThrottlePending = true;
    setTimeout(() => {
      hoverThrottlePending = false;
    }, 32);

    const mlMap = mlMapGetter();
    if (!mlMap) return;

    const features = queryFeaturesAtPoint(
      event.point,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );

    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );

    mlMap.getContainer().classList.toggle("cursor-pointer", features.length > 0);
    // A point/cluster marker under the cursor owns the hover (it wins the hover card and the click),
    // so suppress the shape behind it rather than lighting both features at once.
    const vectorFeature = pointFeature ? null : getVectorFeatureFromFeatures(features);
    setCursorHoverState(
      mlMap,
      vectorFeature,
      pointFeature?.properties?.id ?? pointFeature?.id ?? null,
    );
    // Re-assert the pinned/external highlight every frame so a project selected without a cursor
    // move (sidebar hover, detail open) stays lit; the diff makes an unchanged set a no-op.
    setSelectedHoverState(mlMap);

    // Hover preview card, only on pointer devices (no touch)
    updateHoverPreview(vectorFeature, pointFeature, clientX, clientY);
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    mlMap.getContainer().classList.remove("cursor-pointer");
    clearHoverPreview();

    // Clear only the cursor-driven hover. The pinned/external highlight lives in its own
    // "selected" feature-state and persists; its popup-close watcher handles cleanup.
    setCursorHoverState(mlMap, null, null);
  });

  // The card is anchored to cursor pixels, but MapLibre stops firing mousemove during a
  // drag-pan, so it would freeze on screen while the map slides underneath. Hide it instead.
  // Right-click drag rotates/pitches without firing dragstart, so clear on those too.
  map.value.on("dragstart", clearHoverPreview);
  map.value.on("rotatestart", clearHoverPreview);
  map.value.on("pitchstart", clearHoverPreview);

  map.value.on("click", (event: MapMouseEvent) => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    clearHoverPreview();

    const features = queryFeaturesAtPoint(
      event.point,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );

    // Match the hover precedence (updateHoverPreview checks the point first): a point/cluster marker
    // under the cursor wins over a shape behind it, so the click target agrees with the hover card.
    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );
    if (pointFeature) {
      void handlePointFeatureClick(pointFeature);
      return;
    }

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      handleVectorFeatureClick(vectorFeature);
      return;
    }

    handleBackgroundClick(event.lngLat);
  });
}

// Per-selected-tag project counts for a hovered cluster, read from the count_<tag>/count_untagged
// properties the tile bakes in. Returns undefined when no tag filter is active, so the card falls
// back to the plain cluster count. Tags with a zero count in this cell are omitted.
function buildClusterTagCounts(props: Record<string, unknown>): ClusterTagCount[] | undefined {
  const { includeUntagged, knownTags } = splitTagSelection();
  if (knownTags.length === 0 && !includeUntagged) return undefined;

  const counts: ClusterTagCount[] = [];
  for (const tag of knownTags) {
    const count = Number(props[`count_${tag}`] ?? 0);
    if (count > 0) counts.push({ tag, count });
  }
  if (includeUntagged) {
    const count = Number(props.count_untagged ?? 0);
    if (count > 0) counts.push({ tag: UNTAGGED_PROJECT_FILTER, count });
  }
  return counts.length > 0 ? counts : undefined;
}

// Show the cluster hover card. The representative name is kept only when it's high quality and (under
// an active tag filter) actually matches the selection; the per-tag breakdown is attached so the card
// can report how many of the cluster's projects match each filtered tag.
function showClusterHover(
  pointFeature: RenderedMapFeature,
  cellCount: number,
  clientX: number,
  clientY: number,
): void {
  const props: Record<string, unknown> = pointFeature.properties ?? {};
  const isHighQuality = props.is_high_quality === true;
  let name = isHighQuality ? String(props.name ?? "") : null;
  if (name && selectedProjectTags.value.length > 0) {
    const repTags = String(props.tags ?? "");
    const matches = selectedProjectTags.value.some((tag) => repTags.includes(`"${tag}"`));
    if (!matches) name = null;
  }
  triggerClusterHover(cellCount, clientX, clientY, name, buildClusterTagCounts(props));
}

/**
 * Determine which hover preview to show based on the features under the cursor.
 * Extracted to keep the mousemove handler below the complexity limit.
 */
function updateHoverPreview(
  vectorFeature: RenderedMapFeature | null,
  pointFeature: RenderedMapFeature | undefined,
  clientX: number,
  clientY: number,
): void {
  if (pointFeature) {
    const cellCount = Number(pointFeature.properties?.cell_count ?? 1);
    const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
    if (cellCount > 1) {
      showClusterHover(pointFeature, cellCount, clientX, clientY);
    } else if (projectId.length > 0) {
      triggerProjectHover(projectId, getHoverDataFromFeature(pointFeature), clientX, clientY);
    } else {
      clearHoverPreview();
    }
    return;
  }

  if (vectorFeature) {
    const projectId =
      String(vectorFeature.sourceLayer) === "overlay-footprints"
        ? getFeaturePropertyAsString(vectorFeature, "project_id")
        : getFeaturePropertyAsString(vectorFeature, "id");
    if (projectId.length > 0) {
      triggerProjectHover(projectId, getHoverDataFromFeature(vectorFeature), clientX, clientY);
      return;
    }
  }

  clearHoverPreview();
}

function getFeaturePropertyAsString(feature: RenderedMapFeature, key: string): string {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Extract hover card data from a vector tile feature's properties. */
function getHoverDataFromFeature(feature: RenderedMapFeature): HoverProjectData {
  const name = getFeaturePropertyAsString(feature, "name") || null;
  const timelineStatus = getFeaturePropertyAsString(feature, "timeline_status") || null;
  // Tags are encoded as a JSON array string in the tile (e.g. '["building","road"]')
  let tags: string[] = [];
  try {
    const raw = feature.properties?.tags;
    if (typeof raw === "string" && raw.length > 0) tags = JSON.parse(raw) as string[];
  } catch {
    // malformed tags, leave empty
  }
  return { name, timelineStatus, tags };
}

/**
 * Called once from mlMap.on('load') and after every style switch.
 */
export function addProjectDataToMlMap(mlMap: MaplibreMap): void {
  // The layers below are (re)created with their default filters, so any cached filter is stale.
  appliedLayerFilters.clear();
  // Feature states live on the old sources, which the style switch discards; drop the tracking too.
  appliedFeatureStates.clear();

  // Project shapes/outlines render on top of the whole basemap (undefined beforeId) so the geometry
  // draws above the basemap labels: a sent-to-back overlay image is then covered only by the project
  // vectors, not by distracting street/place names. The overlay footprint outline/fill band is
  // pushed below project-shapes-fill (FOOTPRINT_BAND_BEFORE_ID) so back rasters can anchor between
  // the two: above every footprint border (no border cuts across a neighbour image) but below the
  // project geometry lines. "front" rasters go above the whole group (top of stack).
  // The footprint outline/fill/sentinel layers insert just below the first project-shapes layer.
  const FOOTPRINT_BAND_BEFORE_ID = "project-shapes-fill";

  // Cluster/point layers insert at the top of the stack (undefined beforeId) so the markers and
  // their counts draw above the project shapes, not buried beneath them.

  // ── MVT source: project shapes + overlay footprints + points ──────────────
  mlMap.addSource("project-sources", {
    type: "vector",
    tiles: [TILE_URL],
    minzoom: PROJECT_POINTS_MIN_ZOOM,
    maxzoom: MVT_SOURCE_MAX_ZOOM,
    promoteId: { "overlay-footprints": "id", "project-shapes": "id", "project-points": "id" },
  });

  mlMap.addLayer({
    id: "project-shapes-fill",
    type: "fill",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    // Exclude proposed: they get their own fill layer with reduced opacity
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      ["!=", ["get", "timeline_status"], "proposed"],
    ],
    paint: {
      "fill-color": getProjectLineColorExpression(),
      "fill-opacity": withHoverState(0.2, 0.35),
    },
  });

  // Proposed project shapes fill, lower opacity to reduce visual weight
  mlMap.addLayer({
    id: "project-shapes-proposed-fill",
    type: "fill",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      isProposedFilterExpression,
    ] as FilterSpecification,
    paint: {
      "fill-color": getProjectLineColorExpression(),
      "fill-opacity": withHoverState(0.05, 0.35),
    },
  });

  // Project geometry shapes (lines/polygons), visible from zoom 9
  // under_construction / planned / canceled: long dashes
  mlMap.addLayer({
    id: "project-shapes",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: isNeitherProposedNorCompletedFilterExpression,
    paint: {
      "line-color": getProjectLineColorExpression(),
      // Dashed bases stay static; the solid project-shapes-hover-solid overlay draws the
      // continuous hover/selected highlight on top (line-dasharray can't read feature-state).
      "line-width": SHAPE_LINE_WIDTH,
      "line-dasharray": SHAPE_LONG_DASH,
    },
  });

  // completed project shapes: solid line
  mlMap.addLayer({
    id: "project-shapes-completed",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: isCompletedFilterExpression,
    layout: { "line-cap": "round" },
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": mergeZoomHoverState(SHAPE_LINE_WIDTH, SHAPE_LINE_WIDTH_HOVER),
    },
  });

  // proposed project shapes: short dashes, reduced opacity to visually de-emphasize speculative projects
  mlMap.addLayer({
    id: "project-shapes-proposed-dashed",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: isProposedFilterExpression,
    layout: { "line-cap": "round" },
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": SHAPE_LINE_WIDTH,
      "line-opacity": 0.9,
      "line-dasharray": SHAPE_SHORT_DASH,
    },
  });

  // Solid continuous highlight for the dashed shapes (everything except completed, which is already
  // solid). Stays fully transparent until the feature is hovered/selected, then draws an opaque line
  // over the dashes. Driven purely by feature-state opacity, so toggling it only repaints (no tile
  // reload) the way a setFilter hover layer would have. Tag/status/size/zoom filters are applied via
  // LAYERS_WITH_EXISTING_FILTERS so it never lights a feature the dashed base wouldn't render.
  mlMap.addLayer({
    id: "project-shapes-hover-solid",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: ["!=", ["get", "timeline_status"], "completed"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": SHAPE_LINE_WIDTH_HOVER,
      "line-opacity": ["case", hoverOrSelectedCondition(), 1, 0],
    },
  });

  const hiddenIds = computeHiddenOverlayIds();
  hiddenOverlayIdsCache = hiddenIds;
  const hiddenFilter = hiddenIds.length > 0 ? buildHiddenIdExclusionFilter(hiddenIds) : undefined;

  // Transparent fill so queryRenderedFeatures hits the interior of each footprint polygon,
  // not just its outline pixels. Without this, hover only fires on the dashed border.
  mlMap.addLayer(
    {
      id: "overlay-footprints-fill",
      type: "fill",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: getEffectiveThreshold(OVERLAY_FOOTPRINTS_MIN_ZOOM),
      ...(hiddenFilter ? { filter: hiddenFilter } : {}),
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.001,
      },
    },
    FOOTPRINT_BAND_BEFORE_ID,
  );

  // Invisible sentinel layer, no status filter needed since all footprints trigger overlay loading.
  // vectorTileSync.ts checks for this layer by name to confirm the map is ready.
  mlMap.addLayer(
    {
      id: "overlay-footprints",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: getEffectiveThreshold(OVERLAY_FOOTPRINTS_MIN_ZOOM),
      paint: { "line-width": 0 },
    },
    FOOTPRINT_BAND_BEFORE_ID,
  );

  // Permanent border for overlays. Without a shape outline these images can blend into the basemap,
  // so trace their footprint edge. Sits below the back rasters, so a neighbouring overlay image
  // covers any border that intrudes into it (the outer half of the double-width stroke still shows
  // against the basemap). On hover/selection the opacity rises to full via feature-state, which is
  // what previously took a separate stacked hover layer.
  mlMap.addLayer(
    {
      id: "overlay-footprints-outline",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: getEffectiveThreshold(OVERLAY_FOOTPRINTS_MIN_ZOOM),
      layout: { "line-cap": "round" },
      ...(hiddenFilter ? { filter: hiddenFilter } : {}),
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": FOOTPRINT_LINE_WIDTH,
        "line-opacity": withHoverState(0.6, 1),
      },
    },
    FOOTPRINT_BAND_BEFORE_ID,
  );

  // Individual MVT points
  mlMap.addLayer({
    id: "project-points",
    type: "circle",
    source: "project-sources",
    "source-layer": "project-points",
    minzoom: PROJECT_POINTS_MIN_ZOOM,
    // No maxzoom: standalone (no-geometry) projects have no shape to take over at high zoom,
    // so the center marker must keep rendering past z15 (overzoomed from the z14 MVT source).
    paint: {
      // Hovered/selected: lighten the pending orange and grow the dot, the rest stays put.
      "circle-color": getProjectPointColorExpression(),
      "circle-radius": [
        "case",
        hoverOrSelectedCondition(),
        getPointRadiusExpression(true),
        getPointRadiusExpression(false),
      ] as ExpressionSpecification,
    },
  });

  // Cluster count, drawn over the (enlarged) cluster circles. Only cell_count > 1 gets a label;
  // lone markers stay bare. allow-overlap/ignore-placement keep every count visible at any density.
  mlMap.addLayer({
    id: "project-points-count",
    type: "symbol",
    source: "project-sources",
    "source-layer": "project-points",
    minzoom: PROJECT_POINTS_MIN_ZOOM,
    filter: [">", ["get", "cell_count"], 1],
    layout: {
      "text-field": ["to-string", ["get", "cell_count"]],
      "text-font": ["Noto Sans Bold"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // ── Pending points GeoJSON source ──
  mlMap.addSource("pending-project-points-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
    promoteId: "id",
  });

  mlMap.addLayer({
    id: "pending-project-points",
    type: "circle",
    source: "pending-project-points-source",
    paint: {
      // orange-500, lightening to orange-400 and growing on hover/selection.
      "circle-color": withHoverState("#f97316", "#fb923c"),
      "circle-radius": withHoverState(4, 6),
      "circle-stroke-width": withHoverState(1.5, 2),
      "circle-stroke-color": "#ffffff",
    },
  });

  // Apply current tag filters to MVT layers
  applyTagFiltersToVectorLayers(mlMap);

  initHiddenOverlaysWatcher();
}
