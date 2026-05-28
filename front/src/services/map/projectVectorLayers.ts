import {
  type Map as MaplibreMap,
  type MapMouseEvent,
  type PointLike,
  type FilterSpecification,
  type ExpressionSpecification,
  LngLatBounds,
  addProtocol,
} from "maplibre-gl";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { suppressPopupCloseForClick } from "@/services/map/projectPopupTeleport";
import {
  getCurrentHighlightedProjectId,
  handleBackgroundClick,
  selectOverlay,
} from "@/services/overlay/overlaySelection";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
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
} from "@/services/map/hoverPreviewState";
import {
  mobileAwareFlyTo,
  mobileAwareFlyToBounds,
  flyToGeometry,
} from "@/services/map/mapNavigation";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";
import { getGridCellSizeForTileZoom, tilePxToLngLat } from "@/services/map/tileGrid";
import {
  selectedProjectTags,
  selectedStatusFilters,
  splitTagSelection,
  getNameFilterMode,
  sizeFilterRange,
  lastModifiedDateRange,
} from "@/services/overlay/statusFilters";

/* oxlint-disable no-unsafe-type-assertion */ // disabled because maplibre-gl is clunky to type

// ── Global Request Deduplication for MapLibre ──────────────────────────────
// MapLibre's renderWorldCopies means at zoom level < 3, it renders multiple copies
// of the world to fill horizontal screens. It concurrently fetches identical tiles
// for each world copy (e.g. wrap: -1, wrap: 0, wrap: 1).
// This custom protocol intercepts those fetches and merges concurrent requests for
// the exact same URL into a single backend fetch.

const pendingTileRequests = new Map<string, Promise<ArrayBuffer>>();

addProtocol("dedupe", async (params, _abortController) => {
  const url = params.url.replace("dedupe://", "");

  if (pendingTileRequests.has(url)) {
    const data = await pendingTileRequests.get(url);
    // ArrayBuffers are transferred to WebWorkers by MapLibre, which detaches them.
    // If multiple tile requests wait on the same promise, we MUST clone the ArrayBuffer
    // before handing it to MapLibre, otherwise the 2nd worker gets a detached buffer error.
    if (data) return { data: structuredClone(data) };
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        headers: params.headers,
        // Intentionally not passing abortController.signal.
        // If multiple world copies (wrap 0, wrap 1) wait on this same promise,
        // and one copy gets aborted (e.g. goes off screen), we don't want to cancel
        // the fetch for the other copy that is still visible!
      });
      if (!response.ok) {
        if (response.status === 204) return new ArrayBuffer(0); // Empty tile
        throw new Error(`Tile fetch failed: ${response.status}`);
      }
      return await response.arrayBuffer();
    } finally {
      // Keep it in the map briefly to catch simultaneous world copy requests
      setTimeout(() => {
        pendingTileRequests.delete(url);
      }, 200);
    }
  })();

  pendingTileRequests.set(url, promise);

  const data = await promise;
  return { data: structuredClone(data) };
});

const TILE_URL = `dedupe://${getApiUrl()}/api/tiles/projects/{z}/{x}/{y}`;

// ── Zoom level constants (native MapLibre zoom) ─────────────────────────────
/** Zoom level at which project points appear (prevents overloading with 20k+ points globally) */
const PROJECT_POINTS_MIN_ZOOM = 0;
/** Zoom level at which project points disappear because shapes take over */
const PROJECT_POINTS_MAX_ZOOM = 15;
/** Zoom level at which project shapes (MVT) become visible.
 *  Large shapes appear earlier via getShapeZoomVisibilityFilter, see that function for the full table. */
const PROJECT_SHAPES_MIN_ZOOM = 3;
/** Zoom level at which overlay footprints and point geometries become visible */
const OVERLAY_FOOTPRINTS_MIN_ZOOM = 13;
/** Max zoom for MVT tile source */
const MVT_SOURCE_MAX_ZOOM = 14;

// ── Line styling constants ──────────────────────────────────────────────────
// Overlay footprints use double width because half the stroke is covered by the overlay image.
// Dasharray values are halved for footprints so physical dash/gap sizes stay identical to shapes.
// Line width scales with zoom to avoid the "blobby" antialiasing artifact at low zoom levels.
const SHAPE_LINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 5, 1, 12, 3] as unknown as number;
// +1 wider variant for hover/selected states
const SHAPE_LINE_WIDTH_HOVER = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  2,
  12,
  4,
] as unknown as number;
const FOOTPRINT_LINE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.7,
  12,
  2,
] as unknown as number;

const SHAPE_LONG_DASH: [number, number] = [4, 2];
const SHAPE_SHORT_DASH: [number, number] = [0.2, 2];

// ── Interaction constants ───────────────────────────────────────────────────
const VECTOR_HOVER_HIT_RADIUS_PX = 6;
const HOVER_NONE_ID = "__none__";
// Viewport padding for flyToBounds to leave space around cluster cells.
const CLUSTER_BOUNDS_PADDING_PX = 50;
// Below this zoom, lone points (cell_count===1) still zoom to cell bounds
// instead of opening the project, to avoid a jarring jump from low zoom to z14.
const LONE_POINT_CLICK_MIN_ZOOM = 7;

export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints-fill",
  "project-shapes-fill",
  "project-shapes-proposed-fill",
  "project-shapes",
  "project-shapes-completed",
  "project-shapes-proposed-dashed",
  "project-shapes-points",
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

const DEFAULT_PROJECT_LINE_COLOR = "#3b82f6";

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

function getProjectPointColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "is_pending"], true],
    "#f97316", // Tailwind orange-500
    getTagColorExpression([["get", "first_tag"]]),
  ] as ExpressionSpecification;
}

/**
 * Zoom-dependent size gate for the project-shapes layer.
 * Mirrors the server-side logic in tiles.sql (all values are native MapLibre zoom):
 *   z11+ → all shapes
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
    "any",
    [">=", ["zoom"], 11],
    ["all", [">=", ["zoom"], 10], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 200]],
    ["all", [">=", ["zoom"], 9], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 500]],
    ["all", [">=", ["zoom"], 8], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 1000]],
    ["all", [">=", ["zoom"], 7], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 10_000]],
    ["all", [">=", ["zoom"], 5], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 50_000]],
    ["all", [">=", ["zoom"], 4], [">=", ["coalesce", ["get", "geometry_size_m"], 0], 100_000]],
  ] as FilterSpecification;
}

function getIsProposedFilterExpression(): ExpressionSpecification {
  return ["==", ["get", "timeline_status"], "proposed"];
}

function getIsCompletedFilterExpression(): FilterSpecification {
  return ["==", ["get", "timeline_status"], "completed"] as FilterSpecification;
}

function getIsNeitherProposedNorCompletedFilterExpression(): FilterSpecification {
  return [
    "all",
    ["!=", ["get", "timeline_status"], "proposed"],
    ["!=", ["get", "timeline_status"], "completed"],
  ] as FilterSpecification;
}

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
    conditions.push(["in", tag, ["to-string", ["get", "tags"]]]);
  }

  // Match untagged (empty first_tag)
  if (includeUntagged) {
    conditions.push(["==", ["to-string", ["get", "first_tag"]], ""]);
  }

  if (conditions.length === 0) {
    // Only untagged was selected but we didn't add it, show nothing
    return ["==", 1, 0] as FilterSpecification; // Always false
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
      getIsNeitherProposedNorCompletedFilterExpression(),
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
  "project-shapes-completed": () =>
    [
      "all",
      getIsCompletedFilterExpression(),
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
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
      getIsProposedFilterExpression(),
      getShapeZoomVisibilityFilter(),
    ] as FilterSpecification,
  "project-shapes-points": () => ["==", ["geometry-type"], "Point"] as FilterSpecification, // no zoom gate: these are small stand-ins, already gated to z8+ by null size_m
  "project-shapes-proposed-dashed": () =>
    ["all", getIsProposedFilterExpression(), getShapeZoomVisibilityFilter()] as FilterSpecification,
  "project-points-hover": () => ["==", ["get", "id"], HOVER_NONE_ID] as FilterSpecification,
};

/**
 * Build a MapLibre filter expression based on current timeline status selection.
 */
function getStatusFilterExpression(): FilterSpecification | null {
  // Empty selection = all visible, no filter needed
  if (selectedStatusFilters.value.length === 0) return null;

  return [
    "in",
    ["get", "timeline_status"],
    ["literal", selectedStatusFilters.value],
  ] as FilterSpecification;
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

/**
 * Apply current tag, status, and size filters to all project vector layers.
 * Called when any filter selection changes.
 */
export function applyTagFiltersToVectorLayers(mlMap: MaplibreMap): void {
  const tagFilter = getTagFilterExpression();
  const statusFilter = getStatusFilterExpression();
  const nameFilter = getNameFilterExpression();
  const dateFilter = getLastModifiedDateFilterExpression();
  const baseFilter = combineFilters(tagFilter, statusFilter, nameFilter, dateFilter);

  const pointsFilter = combineFilters(baseFilter, getSizeFilterExpressionForPoints());

  // project-points: tag + status + point size
  if (mlMap.getLayer("project-points")) {
    mlMap.setFilter("project-points", pointsFilter);
  }

  // Layers with existing filters that must be merged
  for (const [layerId, getBaseLayerFilter] of Object.entries(LAYERS_WITH_EXISTING_FILTERS)) {
    if (!mlMap.getLayer(layerId)) continue;

    const baseLayerFilter = getBaseLayerFilter();
    // Points hover keeps points size filter; shape layers keep shapes size filter; overlay footprints have no size filter
    let sizeFilter: FilterSpecification | null = null;
    if (layerId === "project-points-hover") {
      sizeFilter = getSizeFilterExpressionForPoints();
    } else if (!layerId.startsWith("overlay-footprints")) {
      sizeFilter = getSizeFilterExpressionForShapes();
    }
    const merged = combineFilters(baseLayerFilter, baseFilter, sizeFilter);
    mlMap.setFilter(layerId, merged ?? baseLayerFilter);
  }
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

function getHoveredFeatureIds(feature: RenderedMapFeature | null): {
  projectId: string;
  overlayId: string;
} {
  if (!feature) {
    return { projectId: HOVER_NONE_ID, overlayId: HOVER_NONE_ID };
  }

  const sourceLayer = feature.sourceLayer;
  if (sourceLayer === undefined) {
    return {
      projectId: getFeaturePropertyAsString(feature, "id") || HOVER_NONE_ID,
      overlayId: getFeaturePropertyAsString(feature, "overlayId") || HOVER_NONE_ID,
    };
  }

  const isFootprint = sourceLayer === "overlay-footprints";
  const projectIdProp = isFootprint ? "project_id" : "id";
  const projectId = getFeaturePropertyAsString(feature, projectIdProp);
  const overlayId = isFootprint
    ? getFeaturePropertyAsString(feature, "id")
    : (getExternalHoverOverlayId() ?? HOVER_NONE_ID);

  return {
    projectId: projectId.length > 0 ? projectId : HOVER_NONE_ID,
    overlayId: overlayId.length > 0 ? overlayId : HOVER_NONE_ID,
  };
}

// Build a MapLibre filter that matches any of the given ids against the feature's "id" property.
function buildIdMatchFilter(ids: string[]): FilterSpecification {
  return [
    "any",
    ...ids.map((id) => ["==", ["to-string", ["get", "id"]], id]),
  ] as FilterSpecification;
}

let hiddenOverlayIdsCache: string[] = [];

function computeHiddenOverlayIds(): string[] {
  const store = useOverlayStore();
  const hidden = new Set<string>();
  if (store.idSelectedOverlay) hidden.add(store.idSelectedOverlay);
  for (const [id, o] of Object.entries(store.overlays)) {
    if (o.isModified) hidden.add(id);
  }
  return Array.from(hidden);
}

function getHiddenOverlayIds(): string[] {
  return hiddenOverlayIdsCache;
}

let isHiddenOverlaysWatcherInitialized = false;

function initHiddenOverlaysWatcher(): void {
  if (isHiddenOverlaysWatcherInitialized) return;
  isHiddenOverlaysWatcherInitialized = true;

  watch(
    () => computeHiddenOverlayIds(),
    (hiddenIds) => {
      hiddenOverlayIdsCache = hiddenIds;
      const mlMap = map.value;
      if (!mlMap) return;

      const filter =
        hiddenIds.length > 0
          ? ([
              "!",
              ["in", ["to-string", ["get", "id"]], ["literal", hiddenIds]],
            ] as FilterSpecification)
          : undefined;

      if (mlMap.getLayer("overlay-footprints-outline")) {
        mlMap.setFilter("overlay-footprints-outline", filter);
      }
      if (mlMap.getLayer("overlay-footprints-fill")) {
        mlMap.setFilter("overlay-footprints-fill", filter);
      }
    },
  );
}

function setVectorHoverFilters(mlMap: MaplibreMap, feature: RenderedMapFeature | null): void {
  const { projectId, overlayId } = getHoveredFeatureIds(feature);

  const selectedProjectId = getCurrentHighlightedProjectId() ?? HOVER_NONE_ID;
  // The external hover (sidebar card, overlay DOM hover, popup pin) must be preserved
  // even when mousemove returns an empty result, so it's ORed into every hover filter.
  const externalProjectId = getExternalHoverId() ?? HOVER_NONE_ID;
  const externalOverlayId = getExternalHoverOverlayId() ?? HOVER_NONE_ID;

  const projectMatch = buildIdMatchFilter([projectId, selectedProjectId, externalProjectId]);
  const overlayMatchBase = buildIdMatchFilter([overlayId, externalOverlayId]);

  const hiddenIds = getHiddenOverlayIds();
  let overlayMatch: FilterSpecification;
  if (hiddenIds.length > 0) {
    overlayMatch = [
      "all",
      overlayMatchBase,
      ["!", ["in", ["to-string", ["get", "id"]], ["literal", hiddenIds]]],
    ] as FilterSpecification;
  } else {
    overlayMatch = overlayMatchBase;
  }

  mlMap.setFilter("project-shapes-hover", projectMatch);
  mlMap.setFilter("project-shapes-hover-fill", [
    "all",
    ["==", ["geometry-type"], "Polygon"],
    projectMatch,
  ] as FilterSpecification);
  mlMap.setFilter("project-shapes-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    projectMatch,
  ] as FilterSpecification);
  mlMap.setFilter("overlay-footprints-hover", overlayMatch);
  mlMap.setFilter("overlay-footprints-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    overlayMatch,
  ] as FilterSpecification);
}

function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

function handleVectorFeatureClick(
  feature: RenderedMapFeature,
  latlng: { lat: number; lng: number },
): void {
  const sourceLayer = String(feature.sourceLayer);
  const isFootprint = sourceLayer === "overlay-footprints";
  const projectId = isFootprint
    ? getFeaturePropertyAsString(feature, "project_id")
    : getFeaturePropertyAsString(feature, "id");

  if (projectId.length === 0) {
    return;
  }

  // Zoom in if the current zoom is too low to see the shape's detail, but never zoom out.
  // Footprints don't carry geometry_size_m in the tile, so they fall back to zoom 14.
  const geometrySizeM: number = (feature.properties?.geometry_size_m as number | null) ?? 0;
  const willFly = flyToGeometry(latlng, geometrySizeM);

  // Pin the vector highlight immediately so mousemove cannot clear it during the
  // async project fetch that happens inside handleProjectClickFromTile.
  setExternalHover(projectId);

  if (isFootprint) {
    const overlayId = getFeaturePropertyAsString(feature, "id");
    if (overlayId) {
      selectOverlay(overlayId);
    }
  } else {
    // Stop the map-level click handler in projectPopupTeleport from closing the
    // current popup before the new one opens (both fire on the same map click).
    suppressPopupCloseForClick();
    void handleProjectClickFromTile(projectId, latlng, willFly);
  }
}

function setPointHoverFilter(mlMap: MaplibreMap, featureId: string | number | null): void {
  const hoveredId = featureId !== null ? String(featureId) : HOVER_NONE_ID;

  const activeFilter = ["==", ["to-string", ["get", "id"]], hoveredId] as FilterSpecification;

  // Preserve any active tag/status filters alongside the hover match.
  const combinedFilter = combineFilters(
    activeFilter,
    getTagFilterExpression(),
    getStatusFilterExpression(),
  );

  mlMap.setFilter("project-points-hover", combinedFilter);
  mlMap.setFilter("pending-project-points-hover", activeFilter); // pending points don't have status filters
}

/**
 * Highlight a project by id across all hover layers (shapes, footprints, points).
 * Pass null to clear the highlight.
 */
function setHoveredProjectId(
  mlMap: MaplibreMap,
  projectId: string | null,
  overlayId: string | null = null,
): void {
  const id = projectId ?? HOVER_NONE_ID;
  const overlayProp = overlayId ?? HOVER_NONE_ID;
  setVectorHoverFilters(mlMap, projectId ? { properties: { id, overlayId: overlayProp } } : null);
  setPointHoverFilter(mlMap, projectId);
}

function navigateToLonePoint(props: Record<string, unknown>, lat: number, lng: number): void {
  const hasGeometry: boolean = props.has_geometry === true;
  // geometry_size_m is the representative project's own size, not max_size_m, which spans
  // all projects in the cluster cell and is only meaningful for the client-side size filter.
  const geometrySizeM: number = (props.geometry_size_m as number | null) ?? 0;
  // allowPan avoids flyTo's zoom-out arc (and canvas flicker) when no zoom change is needed.
  flyToGeometry([lat, lng], hasGeometry ? geometrySizeM : 0, { allowPan: true });
}

// Map a lat/lng to the tile index and pixel position inside the tile.
function getTileCoordsForLatLng(
  lat: number,
  lng: number,
  tileZoom: number,
): { tileX: number; tileY: number; px: number; py: number } {
  const n = 2 ** tileZoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return { tileX, tileY, px: (x - tileX) * 4096, py: (y - tileY) * 4096 };
}

// Compute the exact bounds of the cluster cell containing the given point.
// The cell bounds are tight (no padding) because fitBounds adds viewport padding
// controlled by CLUSTER_BOUNDS_PADDING_PX.
function getClusterCellBounds(lat: number, lng: number, tileZoom: number): LngLatBounds {
  const safeZoom = Math.max(0, tileZoom);
  const { tileX, tileY, px, py } = getTileCoordsForLatLng(lat, lng, safeZoom);
  const cellSize = getGridCellSizeForTileZoom(safeZoom);
  const cellX = Math.floor(px / cellSize);
  const cellY = Math.floor(py / cellSize);

  // Use exact cell boundaries without geographic padding.
  // Padding will be applied in screen space by fitBounds.
  const minPx = cellX * cellSize;
  const maxPx = (cellX + 1) * cellSize;
  const minPy = cellY * cellSize;
  const maxPy = (cellY + 1) * cellSize;

  const nw = tilePxToLngLat(tileX, tileY, minPx, minPy, safeZoom);
  const se = tilePxToLngLat(tileX, tileY, maxPx, maxPy, safeZoom);
  const bounds = new LngLatBounds();
  bounds.extend([nw[0], nw[1]]);
  bounds.extend([se[0], se[1]]);
  return bounds;
}

/**
 * Zoom into the cluster cell the point belongs to. If the representative matches the active
 * size/date filter, fit the exact cell bounds; otherwise the cluster only passed because some
 * other project in the cell matched, so nudge in by 2 zoom levels instead of committing to
 * the representative's location.
 */
function navigateToCluster(
  props: Record<string, unknown>,
  lat: number,
  lng: number,
  currentZoom: number,
): void {
  const [minFilter, maxFilter] = sizeFilterRange.value;
  const repSize: number | null = (props.geometry_size_m as number | null) ?? null;
  const repMatchesSizeFilter =
    repSize === null || (repSize >= minFilter && (maxFilter === Infinity || repSize <= maxFilter));

  const [minDateMs, maxDateMs] = lastModifiedDateRange.value;
  const repDateS: number | null = (props.last_modified_s as number | null) ?? null;
  const repMatchesDateFilter =
    repDateS === null ||
    (repDateS * 1000 >= minDateMs && (maxDateMs === Infinity || repDateS * 1000 <= maxDateMs));

  const repMatchesFilter = repMatchesSizeFilter && repMatchesDateFilter;

  // Native MapLibre zoom is the integer tile zoom used by the MVT grid logic.
  const tileZoom = Math.floor(currentZoom);

  if (repMatchesFilter) {
    // Fly to the exact cluster cell boundaries. The cell bounds are tight (no geographic padding),
    // and fitBounds will add viewport padding to keep points away from screen edges.
    const cellBounds = getClusterCellBounds(lat, lng, tileZoom);
    const boundsZoom = map.value.cameraForBounds(cellBounds)?.zoom ?? currentZoom;
    mobileAwareFlyToBounds(cellBounds, {
      maxZoom: Math.max(currentZoom, boundsZoom),
      padding: [CLUSTER_BOUNDS_PADDING_PX, CLUSTER_BOUNDS_PADDING_PX],
    });
  } else {
    // Representative doesn't match the active filter, the cluster only passed because some
    // other project in the cell matched. Nudge in by 2 zoom levels without committing to the
    // representative's exact location.
    const targetZoom = currentZoom + 2;
    const duration = Math.min(0.3 + 2 * 0.25, 1.5);
    mobileAwareFlyTo([lat, lng], targetZoom, { duration });
  }
}

async function handlePointFeatureClick(
  pointFeature: any,
  eventLatLng: { lat: number; lng: number },
): Promise<void> {
  const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
  if (projectId.length === 0) return;

  suppressPopupCloseForClick();

  const coordinates = pointFeature.geometry?.coordinates;
  let targetLatLng = eventLatLng;
  let shouldOpenPanel = true;
  let willFly = false;

  if (coordinates && coordinates.length >= 2) {
    const [lng, lat] = coordinates;
    const currentZoom = map.value.getZoom();
    const cellCount: number = pointFeature.properties?.cell_count ?? 2;
    const props: Record<string, unknown> = pointFeature.properties ?? {};

    targetLatLng = { lat, lng };

    if (cellCount === 1 && currentZoom >= LONE_POINT_CLICK_MIN_ZOOM) {
      willFly = true;
      navigateToLonePoint(props, lat, lng);
    } else {
      shouldOpenPanel = false;
      navigateToCluster(props, lat, lng, currentZoom);
    }
  }

  if (shouldOpenPanel) {
    await handleProjectClickFromTile(projectId, targetLatLng, willFly);
  }
}

export function registerHybridInteractionHandlers(mlMapGetter: () => MaplibreMap | null): void {
  registerExternalHoverCallback((projectId, overlayId) => {
    const mlMap = mlMapGetter();
    if (mlMap) setHoveredProjectId(mlMap, projectId, overlayId);
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
    setPointHoverFilter(mlMap, pointFeature?.properties?.id ?? pointFeature?.id ?? null);

    mlMap.getContainer().classList.toggle("cursor-pointer", features.length > 0);
    // The overlay-driven hover (sidebar card, overlay DOM hover, popup pin) is preserved
    // by setVectorHoverFilters' OR-clause, so it's safe to update on every mousemove.
    setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));

    // Hover preview card, only on pointer devices (no touch)
    updateHoverPreview(features, pointFeature, clientX, clientY);
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    mlMap.getContainer().classList.remove("cursor-pointer");
    clearHoverPreview();

    // If a project is pinned (popup open from a click), preserve the highlight.
    // The popup-close watcher in standaloneProjectMarkers/useVisibleProjects handles cleanup.
    if (getExternalHoverId() !== null) return;

    setVectorHoverFilters(mlMap, null);
    setPointHoverFilter(mlMap, null);
  });

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

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      handleVectorFeatureClick(vectorFeature, event.lngLat);
      return;
    }

    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );
    if (pointFeature) {
      void handlePointFeatureClick(pointFeature, event.lngLat);
      return;
    }

    handleBackgroundClick(event.lngLat);
  });
}

/**
 * Determine which hover preview to show based on the features under the cursor.
 * Extracted to keep the mousemove handler below the complexity limit.
 */
function updateHoverPreview(
  features: RenderedMapFeature[],
  pointFeature: RenderedMapFeature | undefined,
  clientX: number,
  clientY: number,
): void {
  if (pointFeature) {
    const cellCount = Number(pointFeature.properties?.cell_count ?? 1);
    const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
    if (cellCount > 1) {
      triggerClusterHover(cellCount, clientX, clientY);
    } else if (projectId.length > 0) {
      triggerProjectHover(projectId, getHoverDataFromFeature(pointFeature), clientX, clientY);
    } else {
      clearHoverPreview();
    }
    return;
  }

  const vectorFeature = getVectorFeatureFromFeatures(features);
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
  // Find insertion point: after all fill-extrusion (3D buildings) layers but before labels.
  // Inserting before the very first symbol layer risks landing under 3D buildings when the
  // basemap style places fill-extrusion layers after its first symbol layers.
  const layers = mlMap.getStyle().layers;
  let lastExtrusionIndex = -1;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (layers[i]?.type === "fill-extrusion") {
      lastExtrusionIndex = i;
      break;
    }
  }
  const firstSymbolLayerId = layers.find(
    (layer, i) => layer.type === "symbol" && i > lastExtrusionIndex,
  )?.id;

  // ── MVT source: project shapes + overlay footprints + points ──────────────
  mlMap.addSource("project-sources", {
    type: "vector",
    tiles: [TILE_URL],
    minzoom: PROJECT_POINTS_MIN_ZOOM,
    maxzoom: MVT_SOURCE_MAX_ZOOM,
    promoteId: { "overlay-footprints": "id", "project-shapes": "id", "project-points": "id" },
  });

  mlMap.addLayer(
    {
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
        "fill-opacity": 0.2,
      },
    },
    firstSymbolLayerId,
  );

  // Proposed project shapes fill, lower opacity to reduce visual weight
  mlMap.addLayer(
    {
      id: "project-shapes-proposed-fill",
      type: "fill",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], getIsProposedFilterExpression()],
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.05,
      },
    },
    firstSymbolLayerId,
  );

  // Project geometry shapes (lines/polygons), visible from zoom 9
  // under_construction / planned / canceled: long dashes
  mlMap.addLayer(
    {
      id: "project-shapes",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: getIsNeitherProposedNorCompletedFilterExpression(),
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 12, 3],
        "line-dasharray": SHAPE_LONG_DASH,
      },
    },
    firstSymbolLayerId,
  );

  // completed project shapes: solid line
  mlMap.addLayer(
    {
      id: "project-shapes-completed",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: getIsCompletedFilterExpression(),
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH,
      },
    },
    firstSymbolLayerId,
  );

  // proposed project shapes: short dashes, reduced opacity to visually de-emphasize speculative projects
  mlMap.addLayer(
    {
      id: "project-shapes-proposed-dashed",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: getIsProposedFilterExpression(),
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH,
        "line-opacity": 0.9,
        "line-dasharray": SHAPE_SHORT_DASH,
      },
    },
    firstSymbolLayerId,
  );

  // Hover highlight for project shapes.
  mlMap.addLayer(
    {
      id: "project-shapes-hover-fill",
      type: "fill",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.35,
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "project-shapes-hover",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH_HOVER,
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "project-shapes-proposed-hover",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: [
        "all",
        getIsProposedFilterExpression(),
        ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
      ],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH_HOVER,
      },
    },
    firstSymbolLayerId,
  );

  const hiddenIds = computeHiddenOverlayIds();
  hiddenOverlayIdsCache = hiddenIds;
  const hiddenFilter =
    hiddenIds.length > 0
      ? (["!", ["in", ["to-string", ["get", "id"]], ["literal", hiddenIds]]] as FilterSpecification)
      : undefined;

  // Transparent fill so queryRenderedFeatures hits the interior of each footprint polygon,
  // not just its outline pixels. Without this, hover only fires on the dashed border.
  mlMap.addLayer(
    {
      id: "overlay-footprints-fill",
      type: "fill",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      ...(hiddenFilter ? { filter: hiddenFilter } : {}),
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.001,
      },
    },
    firstSymbolLayerId,
  );

  // Invisible sentinel layer, no status filter needed since all footprints trigger overlay loading.
  // vectorTileSync.ts checks for this layer by name to confirm the map is ready.
  mlMap.addLayer(
    {
      id: "overlay-footprints",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      paint: { "line-width": 0 },
    },
    firstSymbolLayerId,
  );

  // Permanent border for overlays. Without a shape outline these images can
  // blend into the basemap, so trace their footprint edge using the same
  // styling as the hover border.
  mlMap.addLayer(
    {
      id: "overlay-footprints-outline",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      layout: { "line-cap": "round" },
      ...(hiddenFilter ? { filter: hiddenFilter } : {}),
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": FOOTPRINT_LINE_WIDTH,
        // Subtler than the full-opacity hover layer (stacked above) so hovering still
        // reads as a state change rather than rendering identically.
        "line-opacity": 0.6,
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "overlay-footprints-hover",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": FOOTPRINT_LINE_WIDTH,
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "overlay-footprints-proposed-hover",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: [
        "all",
        getIsProposedFilterExpression(),
        ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
      ],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": FOOTPRINT_LINE_WIDTH,
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "project-shapes-points",
      type: "circle",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": getProjectLineColorExpression(),
        "circle-radius": 4,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  // Individual MVT points
  mlMap.addLayer(
    {
      id: "project-points",
      type: "circle",
      source: "project-sources",
      "source-layer": "project-points",
      minzoom: PROJECT_POINTS_MIN_ZOOM,
      maxzoom: PROJECT_POINTS_MAX_ZOOM,
      paint: {
        "circle-color": getProjectPointColorExpression(),
        "circle-radius": 4,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  // MVT point hover
  mlMap.addLayer(
    {
      id: "project-points-hover",
      type: "circle",
      source: "project-sources",
      "source-layer": "project-points",
      minzoom: PROJECT_POINTS_MIN_ZOOM,
      filter: ["==", ["get", "id"], HOVER_NONE_ID],
      maxzoom: PROJECT_POINTS_MAX_ZOOM,
      paint: {
        "circle-color": [
          "case",
          ["==", ["get", "is_pending"], true],
          "#fb923c", // Tailwind orange-400 (lighter hover)
          getProjectPointColorExpression(),
        ],
        "circle-radius": 6, // larger to indicate hover
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  // ── Pending points GeoJSON source ──
  mlMap.addSource("pending-project-points-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
    promoteId: "id",
  });

  mlMap.addLayer(
    {
      id: "pending-project-points",
      type: "circle",
      source: "pending-project-points-source",
      paint: {
        "circle-color": "#f97316", // Tailwind orange-500
        "circle-radius": 4,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  mlMap.addLayer(
    {
      id: "pending-project-points-hover",
      type: "circle",
      source: "pending-project-points-source",
      filter: ["==", ["get", "id"], HOVER_NONE_ID],
      paint: {
        "circle-color": "#fb923c", // Tailwind orange-400
        "circle-radius": 6,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  // Apply current tag filters to MVT layers
  applyTagFiltersToVectorLayers(mlMap);

  initHiddenOverlaysWatcher();
}
