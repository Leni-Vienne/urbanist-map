import L from "leaflet";
import {
  type Map as MaplibreMap,
  type PointLike,
  type FilterSpecification,
  type ExpressionSpecification,
  addProtocol,
} from "maplibre-gl";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { suppressPopupCloseForClick } from "@/services/map/projectPopupTeleport";
import { getCurrentHighlightedProjectId } from "@/services/overlay/overlaySelection";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

import {
  getOverlayDrivenHoverId,
  getOverlayDrivenHoverOverlayId,
  registerOverlayHoverCallback,
  setOverlayDrivenHover,
} from "@/services/map/vectorHoverState";
import {
  triggerProjectHover,
  triggerClusterHover,
  clearHoverPreview,
  updateHoverPreviewPosition,
} from "@/services/map/hoverPreviewState";
import {
  mobileAwareFlyTo,
  mobileAwarePanTo,
  mobileAwareFlyToBounds,
} from "@/services/map/mapNavigation";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";
import {
  selectedProjectTags,
  UNTAGGED_PROJECT_FILTER,
  visibleStates,
  sizeFilterRange,
  selectedNameFilters,
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
    if (data) return { data: data.slice(0) };
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        headers: params.headers as any,
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
      setTimeout(() => pendingTileRequests.delete(url), 200);
    }
  })();

  pendingTileRequests.set(url, promise);

  const data = await promise;
  return { data: data.slice(0) };
});

const TILE_URL = `dedupe://${getApiUrl()}/api/tiles/projects/{z}/{x}/{y}`;

// ── Zoom level constants (MapLibre zoom = Leaflet zoom - 1) ─────────────────
/** Zoom level at which project points appear (prevents overloading with 20k+ points globally) */
const PROJECT_POINTS_MIN_ZOOM = 0;
/** Zoom level at which project points disappear because shapes take over */
const PROJECT_POINTS_MAX_ZOOM = 15;
/** Zoom level at which project shapes (MVT) become visible.
 *  Large shapes appear earlier via getShapeZoomVisibilityFilter — see that function for the full table. */
const PROJECT_SHAPES_MIN_ZOOM = 3;
/** Zoom level at which overlay footprints and point geometries become visible */
const OVERLAY_FOOTPRINTS_MIN_ZOOM = 13;
/** Max zoom for MVT tile source */
const MVT_SOURCE_MAX_ZOOM = 14;

// ── Line styling constants ──────────────────────────────────────────────────
// Overlay footprints use double width because half the stroke is covered by the overlay image.
// Dasharray values are halved for footprints so physical dash/gap sizes stay identical to shapes.
const SHAPE_LINE_WIDTH = 3;
const FOOTPRINT_LINE_WIDTH = 2; // hiding it for now since project geometry appears over them

const SHAPE_LONG_DASH: [number, number] = [4, 2];
const SHAPE_SHORT_DASH: [number, number] = [0.2, 2];
const FOOTPRINT_LONG_DASH: [number, number] = [2, 1]; // = SHAPE_LONG_DASH / 2
const FOOTPRINT_SHORT_DASH: [number, number] = [0.25, 1]; // = SHAPE_SHORT_DASH / 2

// ── Interaction constants ───────────────────────────────────────────────────
const VECTOR_HOVER_HIT_RADIUS_PX = 6;
const HOVER_NONE_ID = "__none__";
// Viewport padding for flyToBounds to leave space around cluster cells.
const CLUSTER_BOUNDS_PADDING_PX = 50;

export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints-fill",
  "overlay-footprints",
  "overlay-footprints-completed",
  "overlay-footprints-proposed-dashed",
  "project-shapes-fill",
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
 * Mirrors the server-side logic in tiles.sql (all values are MapLibre zoom = Leaflet zoom - 1):
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
  const selected = selectedProjectTags.value;
  if (selected.length === 0) {
    return null; // No filter needed
  }

  const includeUntagged = selected.includes(UNTAGGED_PROJECT_FILTER);
  const selectedKnownTags = selected.filter((t) => t !== UNTAGGED_PROJECT_FILTER);

  const conditions: unknown[] = [];

  // Match any of the selected known tags
  // The backend sends 'tags' as a JSON array string in the MVT tiles
  if (selectedKnownTags.length > 0) {
    for (const tag of selectedKnownTags) {
      conditions.push(["in", tag, ["to-string", ["get", "tags"]]]);
    }
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
  "overlay-footprints": getIsNeitherProposedNorCompletedFilterExpression,
  "overlay-footprints-completed": getIsCompletedFilterExpression,
  "overlay-footprints-proposed-dashed": getIsProposedFilterExpression,
  "project-points-hover": () => ["==", ["get", "id"], HOVER_NONE_ID] as FilterSpecification,
};

/**
 * Build a MapLibre filter expression based on current timeline status selection.
 */
function getStatusFilterExpression(): FilterSpecification | null {
  // If all statuses are visible, we don't need a filter
  const allVisible =
    visibleStates.value.yellow &&
    visibleStates.value.blue &&
    visibleStates.value.orange &&
    visibleStates.value.green &&
    visibleStates.value.grey;

  if (allVisible) {
    return null;
  }

  const allowedStatuses: string[] = [];
  if (visibleStates.value.yellow) allowedStatuses.push("proposed");
  if (visibleStates.value.blue) allowedStatuses.push("planned");
  if (visibleStates.value.orange) allowedStatuses.push("under_construction");
  if (visibleStates.value.green) allowedStatuses.push("completed");
  if (visibleStates.value.grey) allowedStatuses.push("canceled");

  if (allowedStatuses.length === 0) {
    return ["==", 1, 0] as FilterSpecification; // Always false
  }

  return ["in", ["get", "timeline_status"], ["literal", allowedStatuses]] as FilterSpecification;
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
  // Standalone projects (no geometry) are treated as size 0 via coalesce.
  const conditions: unknown[] = [[">=", ["coalesce", ["get", "max_size_m"], 0], minSize]];
  if (maxSize !== Infinity) {
    conditions.push(["<=", ["coalesce", ["get", "min_size_m"], 0], maxSize]);
  }
  return (conditions.length === 1 ? conditions[0] : ["all", ...conditions]) as FilterSpecification;
}

/**
 * Build a size filter expression for the project-shapes layer.
 * Standalone shape-points with missing geometry_size_m pass through the size filter.
 */
function getSizeFilterExpressionForShapes(): FilterSpecification | null {
  const [minSize, maxSize] = sizeFilterRange.value;
  if (minSize === 0 && maxSize === Infinity) return null;

  // Allow missing geometry_size_m to pass through the size filter. (for projects with no geoemtry)
  const conditions: unknown[] = [[">=", ["get", "geometry_size_m"], minSize]];
  if (maxSize !== Infinity) {
    conditions.push(["<=", ["get", "geometry_size_m"], maxSize]);
  }

  const rangeFilter = (
    conditions.length === 1 ? conditions[0] : ["all", ...conditions]
  ) as FilterSpecification;
  return ["any", ["==", ["get", "geometry_size_m"], null], rangeFilter] as FilterSpecification;
}

/**
 * Build a name filter expression. Returns null if no name filter is active.
 */
function getNameFilterExpression(): FilterSpecification | null {
  const selected = selectedNameFilters.value;
  if (selected.length === 0 || (selected.includes("named") && selected.includes("unnamed"))) {
    return null;
  }
  if (selected.includes("named")) {
    return ["==", ["get", "is_named"], 1] as FilterSpecification;
  }
  // unnamed only
  return ["==", ["get", "is_named"], 0] as FilterSpecification;
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
    } else if (layerId.startsWith("overlay-footprints")) {
      sizeFilter = null;
    } else {
      sizeFilter = getSizeFilterExpressionForShapes();
    }
    const merged = combineFilters(baseLayerFilter, baseFilter, sizeFilter);
    mlMap.setFilter(layerId, merged ?? baseLayerFilter);
  }
}

/**
 * Compute the Leaflet zoom level at which a geometry of `sizeMeters` fits
 * within `targetFraction` of the map's shorter viewport dimension.
 * Uses the Web Mercator ground resolution formula adjusted for latitude.
 */
function getZoomForGeometrySize(sizeMeters: number, lat: number, lng: number): number {
  // Approximate a square bounding box centered on the point.
  // 111320m per degree latitude is a standard geodesic constant.
  const halfDegLat = sizeMeters / 2 / 111_320;
  const halfDegLng = halfDegLat / Math.cos((lat * Math.PI) / 180);
  const bounds = L.latLngBounds(
    [lat - halfDegLat, lng - halfDegLng],
    [lat + halfDegLat, lng + halfDegLng],
  );
  return Math.max(8, Math.min(16, map.value.getBoundsZoom(bounds)));
}

function getMaplibrePointFromLeafletEvent(
  event: L.LeafletMouseEvent,
  mlMap: MaplibreMap,
): {
  x: number;
  y: number;
} {
  return mlMap.project([event.latlng.lng, event.latlng.lat]);
}

function queryFeaturesAtLeafletEvent(
  event: L.LeafletMouseEvent,
  mlMap: MaplibreMap,
  layers: readonly string[],
  hitRadius: number,
): any[] {
  const point = getMaplibrePointFromLeafletEvent(event, mlMap);

  if (hitRadius > 0) {
    const bbox: [PointLike, PointLike] = [
      [point.x - hitRadius, point.y - hitRadius],
      [point.x + hitRadius, point.y + hitRadius],
    ];
    return mlMap.queryRenderedFeatures(bbox, { layers: [...layers] });
  }

  return mlMap.queryRenderedFeatures([point.x, point.y], { layers: [...layers] });
}

function getHoveredFeatureIds(feature: RenderedMapFeature | null): {
  projectId: string;
  overlayId: string;
} {
  if (!feature) {
    return { projectId: HOVER_NONE_ID, overlayId: HOVER_NONE_ID };
  }

  const sourceLayer = String((feature as any).sourceLayer ?? "");
  const projectIdProp = sourceLayer === "overlay-footprints" ? "project_id" : "id";
  const projectId = getFeaturePropertyAsString(feature, projectIdProp);
  const overlayId =
    sourceLayer === "overlay-footprints"
      ? getFeaturePropertyAsString(feature, "id")
      : (getOverlayDrivenHoverOverlayId() ?? HOVER_NONE_ID);

  return {
    projectId: projectId.length > 0 ? projectId : HOVER_NONE_ID,
    overlayId: overlayId.length > 0 ? overlayId : HOVER_NONE_ID,
  };
}

function setVectorHoverFilters(mlMap: MaplibreMap, feature: RenderedMapFeature | null): void {
  const { projectId, overlayId } = getHoveredFeatureIds(feature);

  const selectedProjectId = getCurrentHighlightedProjectId() ?? HOVER_NONE_ID;
  const selectedOverlayId = useOverlayStore().idSelectedOverlay ?? HOVER_NONE_ID;

  mlMap.setFilter("project-shapes-hover", [
    "any",
    ["==", ["to-string", ["get", "id"]], projectId],
    ["==", ["to-string", ["get", "id"]], selectedProjectId],
  ]);
  mlMap.setFilter("project-shapes-hover-fill", [
    "all",
    ["==", ["geometry-type"], "Polygon"],
    [
      "any",
      ["==", ["to-string", ["get", "id"]], projectId],
      ["==", ["to-string", ["get", "id"]], selectedProjectId],
    ],
  ]);
  mlMap.setFilter("project-shapes-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    [
      "any",
      ["==", ["to-string", ["get", "id"]], projectId],
      ["==", ["to-string", ["get", "id"]], selectedProjectId],
    ],
  ]);
  mlMap.setFilter("overlay-footprints-hover", [
    "any",
    ["==", ["to-string", ["get", "id"]], overlayId],
    ["==", ["to-string", ["get", "id"]], selectedOverlayId],
  ]);
  mlMap.setFilter("overlay-footprints-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    [
      "any",
      ["==", ["to-string", ["get", "id"]], overlayId],
      ["==", ["to-string", ["get", "id"]], selectedOverlayId],
    ],
  ]);
}

function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

// Returns true if latlng is within EDGE_MARGIN_PX pixels of any viewport edge.
// Used to decide whether to pan after a click so the popup is not clipped.
const EDGE_MARGIN_PX = 120;
function isNearViewportEdge(latlng: L.LatLng): boolean {
  const mapEl = map.value.getContainer();
  const point = map.value.latLngToContainerPoint(latlng);
  return (
    point.x < EDGE_MARGIN_PX ||
    point.y < EDGE_MARGIN_PX ||
    point.x > mapEl.clientWidth - EDGE_MARGIN_PX ||
    point.y > mapEl.clientHeight - EDGE_MARGIN_PX
  );
}

function handleVectorFeatureClick(feature: RenderedMapFeature, latlng: L.LatLng): void {
  const sourceLayer = String(feature.sourceLayer);
  const projectId =
    sourceLayer === "overlay-footprints"
      ? getFeaturePropertyAsString(feature, "project_id")
      : getFeaturePropertyAsString(feature, "id");

  if (projectId.length === 0) {
    return;
  }

  // Zoom in if the current zoom is too low to see the shape's detail, but never zoom out.
  // Footprints don't carry geometry_size_m in the tile, so they fall back to zoom 14.
  const currentZoom = map.value.getZoom();
  const geometrySizeM: number = (feature.properties?.geometry_size_m as number | null) ?? 0;
  const idealZoom =
    geometrySizeM > 0 ? getZoomForGeometrySize(geometrySizeM, latlng.lat, latlng.lng) : 14;
  const targetZoom = Math.max(currentZoom, idealZoom);
  const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);
  if (targetZoom !== currentZoom) {
    mobileAwareFlyTo([latlng.lat, latlng.lng], targetZoom, { duration });
  } else if (isNearViewportEdge(latlng)) {
    // Only pan when the click is close to the edge, so the popup has room to open.
    mobileAwarePanTo([latlng.lat, latlng.lng], { animate: true, duration });
  }

  // Prevent the map-level click handler in projectPopupTeleport from closing the
  // current popup before the new one opens (both fire on the same Leaflet click).
  suppressPopupCloseForClick();

  // Pin the vector highlight immediately so mousemove cannot clear it during the
  // async project fetch that happens inside handleProjectClickFromTile.
  setOverlayDrivenHover(projectId);

  void handleProjectClickFromTile(projectId, latlng);
}

function setPointHoverFilter(mlMap: MaplibreMap, featureId: string | number | null): void {
  const hoveredId = featureId !== null ? String(featureId) : HOVER_NONE_ID;

  const activeFilter = ["==", ["to-string", ["get", "id"]], hoveredId] as FilterSpecification;

  // Also we must preserve tag/status filters if any
  const tagFilter = getTagFilterExpression();
  const statusFilter = getStatusFilterExpression();

  let combinedFilter: any = activeFilter;
  if (tagFilter && statusFilter) {
    combinedFilter = ["all", activeFilter, tagFilter, statusFilter];
  } else if (tagFilter) {
    combinedFilter = ["all", activeFilter, tagFilter];
  } else if (statusFilter) {
    combinedFilter = ["all", activeFilter, statusFilter];
  }

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

function navigateToLonePoint(
  props: Record<string, unknown>,
  lat: number,
  lng: number,
  currentZoom: number,
): void {
  const hasGeometry: boolean = props.has_geometry === true;
  // geometry_size_m is the representative project's own size — not max_size_m, which spans
  // all projects in the cluster cell and is only meaningful for the client-side size filter.
  const geometrySizeM: number = (props.geometry_size_m as number | null) ?? 0;
  const idealZoom =
    hasGeometry && geometrySizeM > 0 ? getZoomForGeometrySize(geometrySizeM, lat, lng) : 14;
  const targetZoom = Math.max(currentZoom, idealZoom);
  const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);
  if (targetZoom === currentZoom) {
    // flyTo zooms out then back in even for pure pans, causing MapLibre canvas flicker.
    // When no zoom change is needed, use panTo to avoid the zoom-out arc.
    mobileAwarePanTo([lat, lng], { animate: true, duration });
  } else {
    mobileAwareFlyTo([lat, lng], targetZoom, { duration });
  }
}

// Mirrors the cell_size lookup in tiles.sql. The tile zoom passed here is MapLibre zoom
// (= Leaflet zoom - 1). Returns the grid cell side length in MVT tile units (out of 4096).
// Only powers of 2 that divide 4096 evenly are used — non-power-of-2 values create partial
// stub cells at tile edges, breaking cross-tile cluster alignment.
function getGridCellSizeForTileZoom(tileZoom: number): number {
  if (tileZoom <= 4) return 1024;
  if (tileZoom <= 6) return 512;
  if (tileZoom <= 12) return 256;
  return 128;
}

// Convert tile coordinates to longitude.
function tileToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

// Convert tile coordinates to latitude.
function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Convert a fractional tile position into longitude and latitude.
function tilePxToLngLat(
  tileX: number,
  tileY: number,
  px: number,
  py: number,
  z: number,
): [number, number] {
  const lng = tileToLng(tileX + px / 4096, z);
  const lat = tileToLat(tileY + py / 4096, z);
  return [lng, lat];
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
// The cell bounds are tight (no padding) because Leaflet's flyToBounds will add
// viewport padding controlled by CLUSTER_BOUNDS_PADDING_PX.
function getClusterCellBounds(lat: number, lng: number, tileZoom: number): L.LatLngBounds {
  const safeZoom = Math.max(0, tileZoom);
  const { tileX, tileY, px, py } = getTileCoordsForLatLng(lat, lng, safeZoom);
  const cellSize = getGridCellSizeForTileZoom(safeZoom);
  const cellX = Math.floor(px / cellSize);
  const cellY = Math.floor(py / cellSize);

  // Use exact cell boundaries without geographic padding.
  // Padding will be applied in screen space by flyToBounds.
  const minPx = cellX * cellSize;
  const maxPx = (cellX + 1) * cellSize;
  const minPy = cellY * cellSize;
  const maxPy = (cellY + 1) * cellSize;

  const nw = tilePxToLngLat(tileX, tileY, minPx, minPy, safeZoom);
  const se = tilePxToLngLat(tileX, tileY, maxPx, maxPy, safeZoom);
  return L.latLngBounds([nw[1], nw[0]], [se[1], se[0]]);
}

/**
 * Returns true and zooms if the cluster representative satisfies the active size filter.
 * Returns false (no zoom) if the representative's own size is outside the filter range,
 * meaning the cluster only passed because some other project elsewhere in the cell matched —
 * zooming to the representative's location would land in an empty area.
 */
function navigateToCluster(
  props: Record<string, unknown>,
  lat: number,
  lng: number,
  currentZoom: number,
): boolean {
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

  // Leaflet zoom = MapLibre zoom + 1. Use the integer tile zoom to match MVT grid logic.
  const tileZoom = Math.floor(currentZoom - 1);

  if (repMatchesFilter) {
    // Fly to the exact cluster cell boundaries. The cell bounds are tight (no geographic padding),
    // and flyToBounds will add viewport padding to keep points away from screen edges.
    const cellBounds = getClusterCellBounds(lat, lng, tileZoom);
    const boundsZoom = map.value.getBoundsZoom(cellBounds, false);
    mobileAwareFlyToBounds(cellBounds, {
      maxZoom: Math.max(currentZoom, boundsZoom),
      padding: [CLUSTER_BOUNDS_PADDING_PX, CLUSTER_BOUNDS_PADDING_PX],
    });
  } else {
    // Representative doesn't match the active filter — the cluster only passed because some
    // other project in the cell matched. Nudge in by 2 zoom levels without committing to the
    // representative's exact location.
    const targetZoom = currentZoom + 2;
    const duration = Math.min(0.3 + 2 * 0.25, 1.5);
    mobileAwareFlyTo([lat, lng], targetZoom, { duration });
  }
  return true;
}

async function handlePointFeatureClick(pointFeature: any, eventLatLng: L.LatLng): Promise<void> {
  const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
  if (projectId.length === 0) return;

  suppressPopupCloseForClick();

  const coordinates = pointFeature.geometry?.coordinates;
  let targetLatLng = eventLatLng;
  let shouldOpenPanel = true;

  if (coordinates && coordinates.length >= 2) {
    const [lng, lat] = coordinates;
    const currentZoom = map.value.getZoom();
    const cellCount: number = pointFeature.properties?.cell_count ?? 2;
    const props: Record<string, unknown> = pointFeature.properties ?? {};

    targetLatLng = L.latLng(lat, lng);

    if (cellCount === 1) {
      navigateToLonePoint(props, lat, lng, currentZoom);
    } else {
      shouldOpenPanel = false;
      if (!navigateToCluster(props, lat, lng, currentZoom)) return;
    }
  }

  if (shouldOpenPanel) {
    await handleProjectClickFromTile(projectId, targetLatLng);
  }
}

export function registerHybridInteractionHandlers(mlMapGetter: () => MaplibreMap | null): void {
  registerOverlayHoverCallback((projectId, overlayId) => {
    const mlMap = mlMapGetter();
    if (mlMap) setHoveredProjectId(mlMap, projectId, overlayId);
  });

  // queryRenderedFeatures is synchronous and walks MapLibre's internal feature tree.
  // Leaflet fires mousemove at up to 500+/sec, which would saturate the main thread.
  // Throttling to ~30fps caps the cost to ~8ms/s instead of ~460ms/s.
  // Position updates are exempt from throttling so the card follows the cursor smoothly.
  let _hoverThrottlePending = false;

  map.value.on("mousemove", (event: L.LeafletMouseEvent) => {
    const clientX = event.originalEvent.clientX;
    const clientY = event.originalEvent.clientY;

    // Always update card position immediately — bypasses Vue render via direct DOM write.
    updateHoverPreviewPosition(clientX, clientY);

    if (_hoverThrottlePending) return;
    _hoverThrottlePending = true;
    setTimeout(() => {
      _hoverThrottlePending = false;
    }, 32);

    const mlMap = mlMapGetter();
    if (!mlMap) return;

    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );

    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );
    setPointHoverFilter(mlMap, pointFeature?.properties?.id ?? pointFeature?.id ?? null);

    // Set cursor on the Leaflet container instead of the MapLibre canvas
    // because the vector MapLibre canvas has pointer-events: none
    map.value.getContainer().style.cursor = features.length > 0 ? "pointer" : "";
    // Don't override an overlay-driven hover with an empty vector result.
    if (getOverlayDrivenHoverId() === null) {
      setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));
    }

    // Hover preview card — only on pointer devices (no touch)
    updateHoverPreview(features, pointFeature, clientX, clientY);
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    map.value.getContainer().style.cursor = "";
    clearHoverPreview();

    // If a project is pinned (popup open from a click), preserve the highlight.
    // The popup-close watcher in standaloneProjectMarkers/useVisibleProjects handles cleanup.
    if (getOverlayDrivenHoverId() !== null) return;

    setVectorHoverFilters(mlMap, null);
    setPointHoverFilter(mlMap, null);
  });

  map.value.on("click", async (event: L.LeafletMouseEvent) => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    clearHoverPreview();

    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );
    if (!features.length) return;

    if (import.meta.env.DEV) {
      //console.log("[vector click] all features:", features);
    }

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      if (import.meta.env.DEV) {
        //console.log("[vector click] vector feature:", vectorFeature.layer?.id, vectorFeature);
      }
      handleVectorFeatureClick(vectorFeature, event.latlng);
      return;
    }

    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );
    if (pointFeature) {
      if (import.meta.env.DEV) {
        /*console.log(
          "[vector click] point feature:",
          pointFeature.layer?.id,
          pointFeature.properties,
        );*/
      }
      void handlePointFeatureClick(pointFeature, event.latlng);
    }
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
      triggerProjectHover(projectId, clientX, clientY);
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
      triggerProjectHover(projectId, clientX, clientY);
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

// Gray shades for road types, replacing Liberty's yellow/orange major roads.
// Minor roads and paths are already white/gray in Liberty and are left unchanged.
const ROAD_COLOR_OVERRIDES: Record<string, string> = {
  motorway: "#c0bfbf",
  trunk: "#d0cfcf",
  primary: "#e0dfdf",
  secondary: "#ebebeb",
  tertiary: "#f0efef",
};

// Casing (outline) colors — slightly darker than the fill
const ROAD_CASING_OVERRIDES: Record<string, string> = {
  motorway: "#a8a8a8",
  trunk: "#b8b8b8",
  primary: "#cccccc",
  secondary: "#d8d8d8",
  tertiary: "#dedede",
};

/**
 * Overrides Liberty basemap road colors to a neutral gray palette.
 * Only runs when the plan (vector) style is active — satellite styles have no road layers.
 * Matches Liberty layer IDs like "road_trunk", "road_primary_casing", "tunnel_motorway", etc.
 */
export function applyPlanStyleRoadOverrides(mlMap: MaplibreMap): void {
  const layers = mlMap.getStyle().layers;

  for (const layer of layers) {
    if (layer.type !== "line") continue;

    // Only target basemap road/tunnel/bridge layers
    const id = layer.id;
    if (!id.startsWith("road") && !id.startsWith("tunnel") && !id.startsWith("bridge")) continue;

    const isCasing = id.includes("casing") || id.includes("outline") || id.includes("border");

    for (const [roadType, color] of Object.entries(
      isCasing ? ROAD_CASING_OVERRIDES : ROAD_COLOR_OVERRIDES,
    )) {
      if (id.includes(roadType)) {
        mlMap.setPaintProperty(id, "line-color", color);
        break;
      }
    }
  }
}

/**
 * Applies overrides to the Liberty basemap's railway styling to visually
 * differentiate it from our tram project geometries.
 * Makes existing railways gray, slightly dashed, and semi-transparent.
 */
export function applyRailStyleOverrides(mlMap: MaplibreMap): void {
  const layers = mlMap.getStyle().layers;

  for (const layer of layers) {
    if (layer.type !== "line") continue;

    const id = layer.id;
    // Target rail lines (excluding subway/subway-casing if any, though Liberty
    // usually names them "railway_transit" etc.)
    //if (!id.startsWith("railway") && !id.includes("rail")) continue;
    if (id.includes("road_major_rail") || id.includes("bridge_major_rail")) {
      // Dim the main rail line
      mlMap.setPaintProperty(id, "line-color", "#f97316");
      mlMap.setPaintProperty(id, "line-opacity", 0.7);
    }
    if (id.includes("tunnel_major_rail")) {
      mlMap.setPaintProperty(id, "line-color", "#f97316");
      mlMap.setPaintProperty(id, "line-opacity", 0.5);
    }
  }
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

  // Proposed project shapes fill — lower opacity to reduce visual weight
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

  // Project geometry shapes (lines/polygons) — visible from zoom 9
  // under_construction / planned / canceled: long dashes
  mlMap.addLayer(
    {
      id: "project-shapes",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: getIsNeitherProposedNorCompletedFilterExpression(),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH,
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
      layout: { "line-join": "round", "line-cap": "round" },
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
      layout: { "line-join": "round", "line-cap": "round" },
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
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH + 1,
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
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": SHAPE_LINE_WIDTH + 1,
      },
    },
    firstSymbolLayerId,
  );

  // Transparent fill so queryRenderedFeatures hits the interior of each footprint polygon,
  // not just its outline pixels. Without this, hover only fires on the dashed border.
  mlMap.addLayer(
    {
      id: "overlay-footprints-fill",
      type: "fill",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.001,
      },
    },
    firstSymbolLayerId,
  );

  // Overlay footprints — permanent border outline replacing CSS box-shadow hack
  // Width is 6 (double project-shapes) because half the stroke is covered by the overlay image.
  // Dasharray values are halved vs project-shapes so physical dash/gap sizes stay identical.
  // under_construction / planned / canceled: long dashes
  mlMap.addLayer(
    {
      id: "overlay-footprints",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: getIsNeitherProposedNorCompletedFilterExpression(),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 0, // temporary
        "line-dasharray": FOOTPRINT_LONG_DASH,
      },
    },
    firstSymbolLayerId,
  );

  // completed overlay footprints: solid line
  mlMap.addLayer(
    {
      id: "overlay-footprints-completed",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: getIsCompletedFilterExpression(),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": FOOTPRINT_LINE_WIDTH,
      },
    },
    firstSymbolLayerId,
  );

  // proposed overlay footprints: short dashes, reduced opacity to visually de-emphasize speculative projects
  mlMap.addLayer(
    {
      id: "overlay-footprints-proposed-dashed",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: getIsProposedFilterExpression(),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 0, // temporary
        "line-dasharray": FOOTPRINT_SHORT_DASH,
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
      layout: { "line-join": "round", "line-cap": "round" },
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
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 0, // temporary
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
}
