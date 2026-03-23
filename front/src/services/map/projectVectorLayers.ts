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

// ── Global Request Deduplication for MapLibre ──────────────────────────────
// MapLibre's renderWorldCopies means at zoom level < 3, it renders multiple copies
// of the world to fill horizontal screens. It concurrently fetches identical tiles
// for each world copy (e.g. wrap: -1, wrap: 0, wrap: 1).
// This custom protocol intercepts those fetches and merges concurrent requests for
// the exact same URL into a single backend fetch.

const pendingTileRequests = new Map<string, Promise<ArrayBuffer>>();

addProtocol("dedupe", async (params, abortController) => {
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
/** Zoom level at which project shapes (MVT) become visible */
const PROJECT_SHAPES_MIN_ZOOM = 9;
/** Zoom level at which overlay footprints and point geometries become visible */
const OVERLAY_FOOTPRINTS_MIN_ZOOM = 13;
/** Max zoom for MVT tile source */
const MVT_SOURCE_MAX_ZOOM = 14;

// ── Interaction constants ───────────────────────────────────────────────────
const VECTOR_HOVER_HIT_RADIUS_PX = 6;
const HOVER_NONE_ID = "__none__";

const VECTOR_QUERY_LAYERS = [
  "overlay-footprints",
  "overlay-footprints-proposed-dashed",
  "project-shapes-fill",
  "project-shapes",
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

function getIsProposedFilterExpression(): ExpressionSpecification {
  return ["==", ["get", "timeline_status"], "proposed"];
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
  "project-shapes-fill": () => ["==", ["geometry-type"], "Polygon"] as FilterSpecification,
  "project-shapes-points": () => ["==", ["geometry-type"], "Point"] as FilterSpecification,
  "project-shapes-proposed-dashed": getIsProposedFilterExpression,
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
 * Standalone shape-points (null geometry_size_m) pass through as size 0.
 */
function getSizeFilterExpressionForShapes(): FilterSpecification | null {
  const [minSize, maxSize] = sizeFilterRange.value;
  if (minSize === 0 && maxSize === Infinity) return null;

  const conditions: unknown[] = [[">=", ["coalesce", ["get", "geometry_size_m"], 0], minSize]];
  if (maxSize !== Infinity) {
    conditions.push(["<=", ["coalesce", ["get", "geometry_size_m"], 0], maxSize]);
  }
  return (conditions.length === 1 ? conditions[0] : ["all", ...conditions]) as FilterSpecification;
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
 * Build a last modified date filter expression. Returns null if filter is at its default.
 * The tile property `last_modified_s` is in Unix seconds.
 */
function getLastModifiedDateFilterExpression(): FilterSpecification | null {
  const [minMs, maxMs] = lastModifiedDateRange.value;
  if (minMs === 0 && maxMs === Infinity) return null;

  const minS = Math.floor(minMs / 1000);
  const conditions: unknown[] = [[">=", ["get", "last_modified_s"], minS]];
  if (maxMs !== Infinity) {
    conditions.push(["<=", ["get", "last_modified_s"], Math.floor(maxMs / 1000)]);
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
  const shapesFilter = combineFilters(baseFilter, getSizeFilterExpressionForShapes());

  // project-points: tag + status + point size
  if (mlMap.getLayer("project-points")) {
    mlMap.setFilter("project-points", pointsFilter);
  }

  // project-shapes and overlay-footprints: tag + status + shape size (footprints inherit shape size)
  for (const layerId of ["project-shapes", "overlay-footprints"] as const) {
    if (!mlMap.getLayer(layerId)) continue;
    mlMap.setFilter(layerId, shapesFilter);
  }

  // Layers with existing filters that must be merged
  for (const [layerId, getBaseLayerFilter] of Object.entries(LAYERS_WITH_EXISTING_FILTERS)) {
    if (!mlMap.getLayer(layerId)) continue;

    const baseLayerFilter = getBaseLayerFilter();
    // Points hover keeps points size filter; shapes-derived layers keep shapes size filter
    const sizeFilter =
      layerId === "project-points-hover"
        ? getSizeFilterExpressionForPoints()
        : getSizeFilterExpressionForShapes();
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
  const halfDegLat = sizeMeters / 2 / 111320;
  const halfDegLng = halfDegLat / Math.cos((lat * Math.PI) / 180);
  const bounds = L.latLngBounds(
    [lat - halfDegLat, lng - halfDegLng],
    [lat + halfDegLat, lng + halfDegLng],
  );
  return Math.max(8, Math.min(16, map.value.getBoundsZoom(bounds)));
}

function getNextGridZoom(currentZoom: number): number {
  if (currentZoom <= 4) return 5;
  if (currentZoom <= 6) return 7;
  if (currentZoom <= 8) return 9;
  if (currentZoom <= 10) return 11;
  return currentZoom + 2;
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

function getHoveredVectorId(feature: RenderedMapFeature | null): string {
  if (!feature) {
    return HOVER_NONE_ID;
  }

  const id = getFeaturePropertyAsString(feature, "id");
  return id.length > 0 ? id : HOVER_NONE_ID;
}

function setVectorHoverFilters(mlMap: MaplibreMap, feature: RenderedMapFeature | null): void {
  const hoveredId = getHoveredVectorId(feature);

  mlMap.setFilter("project-shapes-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  mlMap.setFilter("project-shapes-hover-fill", [
    "all",
    ["==", ["geometry-type"], "Polygon"],
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
  mlMap.setFilter("project-shapes-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
  mlMap.setFilter("overlay-footprints-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  mlMap.setFilter("overlay-footprints-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
}

function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

function handleVectorFeatureClick(feature: RenderedMapFeature, latlng: L.LatLng): void {
  const sourceLayer = String(feature.sourceLayer ?? "");
  const projectId =
    sourceLayer === "overlay-footprints"
      ? getFeaturePropertyAsString(feature, "project_id")
      : getFeaturePropertyAsString(feature, "id");

  if (projectId.length === 0) {
    return;
  }

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
export function setHoveredProjectId(mlMap: MaplibreMap, projectId: string | null): void {
  const id = projectId ?? HOVER_NONE_ID;
  setVectorHoverFilters(mlMap, projectId ? { properties: { id } } : null);
  setPointHoverFilter(mlMap, projectId);
}

export function registerHybridInteractionHandlers(mlMapGetter: () => MaplibreMap | null): void {
  map.value.on("mousemove", (event: L.LeafletMouseEvent) => {
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

    mlMap.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    mlMap.getCanvas().style.cursor = "";
    setVectorHoverFilters(mlMap, null);
    setPointHoverFilter(mlMap, null);
  });

  map.value.on("click", async (event: L.LeafletMouseEvent) => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );
    if (!features.length) {
      return;
    }

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      handleVectorFeatureClick(vectorFeature, event.latlng);
      return;
    }

    const pointFeature = features.find(
      (f) => f?.layer?.id === "project-points" || f?.layer?.id === "pending-project-points",
    );
    if (pointFeature) {
      console.log("Clicked point feature:", pointFeature);
      const projectId = String(pointFeature.properties?.id ?? pointFeature.id ?? "");
      if (projectId.length > 0) {
        const coordinates = pointFeature.geometry?.coordinates;
        let targetLatLng = event.latlng;
        let shouldOpenPanel = true;

        if (coordinates && coordinates.length >= 2) {
          const [lng, lat] = coordinates;
          const currentZoom = map.value.getZoom();
          const cellCount: number = pointFeature.properties?.cell_count ?? 2;

          // Use exact feature coordinates to prevent massive popup offset when zooming in
          targetLatLng = L.latLng(lat, lng);

          if (cellCount === 1) {
            // Lone point: it's already rendered and passed all active filters, so open the panel.
            // Zoom to the appropriate level: shapes zoom (Leaflet 10) for projects with geometry,
            // or a closer zoom (Leaflet 14) for standalone point-only projects.
            const hasGeometry: boolean = pointFeature.properties?.has_geometry === true;
            const maxSizeM: number = pointFeature.properties?.max_size_m ?? 0;
            const idealZoom =
              hasGeometry && maxSizeM > 0 ? getZoomForGeometrySize(maxSizeM, lat, lng) : 14;
            const targetZoom = Math.max(currentZoom, idealZoom);
            const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);
            map.value.flyTo([lat, lng], targetZoom, { duration });
          } else {
            // Cluster: jump three grid tiers to give the cluster a real chance of splitting.
            // Never open the panel -- the user needs to click the actual visible point after zoom.
            shouldOpenPanel = false;
            const targetZoom = getNextGridZoom(getNextGridZoom(getNextGridZoom(currentZoom)));
            const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);
            map.value.flyTo([lat, lng], targetZoom, { duration });
          }
        }

        if (shouldOpenPanel) {
          void handleProjectClickFromTile(projectId, targetLatLng);
        }
      }
    }
  });
}

function getFeaturePropertyAsString(feature: RenderedMapFeature, key: string): string {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Add all project-related MapLibre sources and layers.
 * Called once from mlMap.on('load') and after every style switch.
 */
export function addProjectDataToMlMap(mlMap: MaplibreMap): void {
  // Find the first symbol layer in the basemap so we can render our points under the labels
  const layers = mlMap.getStyle().layers;
  const firstSymbolLayerId = layers?.find((layer) => layer.type === "symbol")?.id;

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
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": getProjectLineColorExpression(),
        "fill-opacity": 0.2,
      },
    },
    firstSymbolLayerId,
  );

  // Project geometry shapes (lines/polygons) — visible from zoom 9
  mlMap.addLayer(
    {
      id: "project-shapes",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 3,
        "line-dasharray": [4, 1.5],
      },
    },
    firstSymbolLayerId,
  );

  // Proposed project shapes are overlaid as dashed lines.
  mlMap.addLayer(
    {
      id: "project-shapes-proposed-dashed",
      type: "line",
      source: "project-sources",
      "source-layer": "project-shapes",
      minzoom: PROJECT_SHAPES_MIN_ZOOM,
      filter: getIsProposedFilterExpression(),
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 2,
        "line-dasharray": [2, 1.5],
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
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 4,
        "line-opacity": 1,
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
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 4,
        "line-opacity": 1,
        "line-dasharray": [2, 1.5],
      },
    },
    firstSymbolLayerId,
  );

  // Overlay footprints — permanent border outline replacing CSS box-shadow hack
  mlMap.addLayer(
    {
      id: "overlay-footprints",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 1.5,
        "line-opacity": 0.7,
      },
    },
    firstSymbolLayerId,
  );

  // Proposed overlay footprints inherit proposed state from their parent project.
  mlMap.addLayer(
    {
      id: "overlay-footprints-proposed-dashed",
      type: "line",
      source: "project-sources",
      "source-layer": "overlay-footprints",
      minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
      filter: getIsProposedFilterExpression(),
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 1.5,
        "line-opacity": 0.7,
        "line-dasharray": [2, 1.5],
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
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 3.5,
        "line-opacity": 1,
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
      paint: {
        "line-color": getProjectLineColorExpression(),
        "line-width": 3.5,
        "line-opacity": 1,
        "line-dasharray": [2, 1.5],
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
        "circle-radius": 6,
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
        "circle-radius": 6,
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
        "circle-radius": 8, // larger to indicate hover
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
        "circle-radius": 6,
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
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    },
    firstSymbolLayerId,
  );

  // Apply current tag filters to MVT layers
  applyTagFiltersToVectorLayers(mlMap);
}
