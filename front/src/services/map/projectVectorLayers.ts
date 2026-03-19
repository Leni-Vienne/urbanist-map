import L from "leaflet";
import type {
  Map as MaplibreMap,
  PointLike,
  FilterSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";
import {
  filterGeoJsonByTags,
  selectedProjectTags,
  UNTAGGED_PROJECT_FILTER,
  visibleStates,
} from "@/services/overlay/statusFilters";

export const TILE_URL = `${getApiUrl()}/api/tiles/projects/{z}/{x}/{y}`;

// ── Zoom level constants (MapLibre zoom = Leaflet zoom - 1) ─────────────────
/** Zoom level at which clustering stops and individual points appear */
export const CLUSTER_MAX_ZOOM = 13;
/** Radius in pixels for clustering nearby points */
export const CLUSTER_RADIUS = 50;
/** Zoom level at which cluster/point layers disappear (exclusive) */
export const CLUSTER_LAYER_MAX_ZOOM = 15;
/** Zoom level at which project shapes (MVT) become visible */
export const PROJECT_SHAPES_MIN_ZOOM = 9; // TEMP: was 9, testing MVT from afar
/** Zoom level at which overlay footprints and point geometries become visible */
export const OVERLAY_FOOTPRINTS_MIN_ZOOM = 13;
/** Max zoom for MVT tile source */
export const MVT_SOURCE_MAX_ZOOM = 14;

// ── Interaction constants ───────────────────────────────────────────────────
export const VECTOR_HOVER_HIT_RADIUS_PX = 6;
export const HOVER_NONE_ID = "__none__";

export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints",
  "overlay-footprints-proposed-dashed",
  "project-shapes-fill",
  "project-shapes",
  "project-shapes-proposed-dashed",
  "project-shapes-points",
] as const;

export const CLICK_QUERY_LAYERS = [
  // TEMP: cluster/point layers disabled for testing
  "clusters",
  ...VECTOR_QUERY_LAYERS,
  "unclustered-point",
] as const;

export type RenderedMapFeature = {
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

export const DEFAULT_PROJECT_LINE_COLOR = "#3b82f6";

export const PROJECT_LINE_COLOR_BY_TAG: Record<string, string> = {};

for (const tag of PROJECT_TAGS) {
  PROJECT_LINE_COLOR_BY_TAG[tag.slug] = tag.color;
}

export function getTagColorExpression(tagExpression: unknown[]): ExpressionSpecification {
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

export function getProjectLineColorExpression(): ExpressionSpecification {
  return getTagColorExpression([["get", "first_tag"]]);
}

export function getProjectPointColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "is_pending"], true],
    "#f97316", // Tailwind orange-500
    getTagColorExpression([["get", "first_tag"]]),
  ] as ExpressionSpecification;
}

export function getIsProposedFilterExpression(): ExpressionSpecification {
  return ["==", ["get", "timeline_status"], "proposed"];
}

/**
 * Build a MapLibre filter expression based on current tag selection.
 * Returns null if no filtering is needed (all tags visible).
 */
export function getTagFilterExpression(): FilterSpecification | null {
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

// Layers that need tag filtering applied
// Layers that can have their filter fully replaced by tag filter
const TAG_FILTERABLE_LAYERS = ["project-shapes", "overlay-footprints"] as const;

// Layers with existing filters that need tag filter merged with "all"
const LAYERS_WITH_EXISTING_FILTERS: Record<string, () => FilterSpecification> = {
  "project-shapes-fill": () => ["==", ["geometry-type"], "Polygon"] as FilterSpecification,
  "project-shapes-points": () => ["==", ["geometry-type"], "Point"] as FilterSpecification,
  "project-shapes-proposed-dashed": getIsProposedFilterExpression,
  "overlay-footprints-proposed-dashed": getIsProposedFilterExpression,
};

/**
 * Build a MapLibre filter expression based on current timeline status selection.
 */
export function getStatusFilterExpression(): FilterSpecification | null {
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
 * Apply current tag and status filters to all project vector layers.
 * Called when the filter selection changes.
 */
export function applyTagFiltersToVectorLayers(mlMap: MaplibreMap): void {
  const tagFilter = getTagFilterExpression();
  const statusFilter = getStatusFilterExpression();

  let combinedFilter: any = null;
  if (tagFilter && statusFilter) {
    combinedFilter = ["all", tagFilter, statusFilter];
  } else if (tagFilter) {
    combinedFilter = tagFilter;
  } else if (statusFilter) {
    combinedFilter = statusFilter;
  }

  // Apply to simple layers (filter can be fully replaced)
  for (const layerId of TAG_FILTERABLE_LAYERS) {
    if (!mlMap.getLayer(layerId)) continue;

    if (combinedFilter) {
      mlMap.setFilter(layerId, combinedFilter);
    } else {
      // Clear filter by setting it to null (which MapLibre allows via setFilter but types don't always reflect)
      mlMap.setFilter(layerId, null);
    }
  }

  // Apply to layers that have existing filters (merge with "all")
  for (const [layerId, getBaseFilter] of Object.entries(LAYERS_WITH_EXISTING_FILTERS)) {
    if (!mlMap.getLayer(layerId)) continue;

    const baseFilter = getBaseFilter();
    if (combinedFilter) {
      mlMap.setFilter(layerId, ["all", baseFilter, combinedFilter] as any);
    } else {
      mlMap.setFilter(layerId, baseFilter);
    }
  }
}

export function buildClusterProperties(): Record<string, ExpressionSpecification> {
  const clusterProperties: Record<string, ExpressionSpecification> = {};

  for (const tag of PROJECT_TAGS) {
    clusterProperties[`tag_${tag.slug}`] = [
      "+",
      ["case", ["==", ["downcase", ["to-string", ["get", "first_tag"]]], tag.slug], 1, 0],
    ] as ExpressionSpecification;
  }

  // Count pending projects inside the cluster (used to color the whole cluster orange from afar)
  clusterProperties.pending_count = [
    "+",
    ["case", ["==", ["get", "is_pending"], true], 1, 0],
  ] as ExpressionSpecification;

  return clusterProperties;
}

export function getSingleProjectClusterColorExpression(): ExpressionSpecification {
  const expression: unknown[] = ["case"];

  for (const tag of PROJECT_TAGS) {
    expression.push(["==", ["get", `tag_${tag.slug}`], 1], tag.color);
  }

  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression as ExpressionSpecification;
}

export function getMaplibrePointFromLeafletEvent(
  event: L.LeafletMouseEvent,
  mlMap: MaplibreMap,
): {
  x: number;
  y: number;
} {
  return mlMap.project([event.latlng.lng, event.latlng.lat]);
}

export function queryFeaturesAtLeafletEvent(
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

export function getHoveredVectorId(feature: RenderedMapFeature | null): string {
  if (!feature) {
    return HOVER_NONE_ID;
  }

  const id = getFeaturePropertyAsString(feature, "id");
  return id.length > 0 ? id : HOVER_NONE_ID;
}

export function setVectorHoverFilters(
  mlMap: MaplibreMap,
  feature: RenderedMapFeature | null,
): void {
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

export function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

export function handleVectorFeatureClick(feature: RenderedMapFeature, latlng: L.LatLng): void {
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

export function setClusterHoverFilter(mlMap: MaplibreMap, clusterId: number | null): void {
  // TEMP: skip if layer doesn't exist (clustering disabled)
  //if (!mlMap.getLayer("clusters-hover")) return;
  mlMap.setFilter("clusters-hover", [
    "all",
    ["has", "point_count"],
    ["==", ["get", "cluster_id"], clusterId ?? -1],
  ] as unknown as FilterSpecification);
}

export function setUnclusteredPointHoverFilter(
  mlMap: MaplibreMap,
  featureId: string | number | null,
): void {
  // TEMP: skip if layer doesn't exist (points disabled)
  //if (!mlMap.getLayer("unclustered-point-hover")) return;
  mlMap.setFilter("unclustered-point-hover", [
    "all",
    ["!", ["has", "point_count"]],
    ["==", ["get", "id"], featureId ?? HOVER_NONE_ID],
  ] as unknown as FilterSpecification);
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

    const clusterFeature = features.find((f) => f?.layer?.id === "clusters");
    setClusterHoverFilter(mlMap, clusterFeature?.properties?.cluster_id ?? null);

    const unclusteredPoint = features.find((f) => f?.layer?.id === "unclustered-point");
    setUnclusteredPointHoverFilter(
      mlMap,
      unclusteredPoint?.properties?.id ?? unclusteredPoint?.id ?? null,
    );

    mlMap.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    mlMap.getCanvas().style.cursor = "";
    setVectorHoverFilters(mlMap, null);
    setClusterHoverFilter(mlMap, null);
    setUnclusteredPointHoverFilter(mlMap, null);
  });

  map.value.on("click", async (event: L.LeafletMouseEvent) => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    console.log("Map click at", event.latlng);
    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );
    if (!features.length) {
      return;
    }
    console.log(features.flatMap((f) => f?.properties));

    const clusterFeature = features.find((feature) => feature?.layer?.id === "clusters");
    if (clusterFeature) {
      const clusterId = clusterFeature.properties?.cluster_id;

      try {
        const expansionZoom = await (
          mlMap.getSource("project-points") as any
        ).getClusterExpansionZoom(clusterId);
        const coordinates = clusterFeature.geometry?.coordinates;

        if (coordinates && coordinates.length >= 2) {
          const [lng, lat] = coordinates;

          const currentZoom = map.value?.getZoom() || 0;
          // Ensure we always visibly zoom in by at least 2 levels (standard clustering UX),
          // or use MapLibre's recommended zoom if it's deeper.
          const targetZoom = Math.max(currentZoom + 2, Math.ceil(expansionZoom));

          // Use standard flyTo. Without forced duration, Leaflet calculates the best physics.
          map.value?.flyTo([lat, lng], targetZoom, { duration: 1.5 });
        }
      } catch (error) {
        console.error("Error getting cluster expansion zoom:", error);
      }
      return;
    }

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      handleVectorFeatureClick(vectorFeature, event.latlng);
      return;
    }

    const unclusteredPoint = features.find((f) => f?.layer?.id === "unclustered-point");
    if (unclusteredPoint) {
      const projectId = String(unclusteredPoint.properties?.id ?? unclusteredPoint.id ?? "");
      if (projectId.length > 0) {
        const coordinates = unclusteredPoint.geometry?.coordinates;
        let targetLatLng = event.latlng;

        if (coordinates && coordinates.length >= 2) {
          const [lng, lat] = coordinates;
          const currentZoom = map.value?.getZoom() || 0;
          const targetZoom = Math.max(currentZoom + 2, 14); // Zoom in enough to see the shapes
          map.value?.flyTo([lat, lng], targetZoom, { duration: 1.5 });

          // Use exact feature coordinates to prevent massive popup offset when zooming in
          targetLatLng = L.latLng(lat, lng);
        }

        void handleProjectClickFromTile(projectId, targetLatLng);
      }
    }
  });
}

export function addFirstTagToProjectPointsGeojson(
  geojson: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const enrichedFeatures = [] as GeoJSON.Feature[];

  for (const feature of geojson.features) {
    const featureProps = (feature.properties ?? {}) as Record<string, unknown>;
    const existingFirstTag = featureProps.first_tag;
    const tags = Array.isArray(featureProps.tags)
      ? (featureProps.tags as unknown[])
      : ([] as unknown[]);
    const firstTagFromTags = typeof tags[0] === "string" ? String(tags[0]) : "";

    const firstTag =
      typeof existingFirstTag === "string" && existingFirstTag.length > 0
        ? existingFirstTag
        : firstTagFromTags;

    const featureId = feature.id ?? featureProps.id;

    enrichedFeatures.push({
      ...feature,
      id: featureId as string | number, // Also set it on the feature root
      properties: {
        ...featureProps,
        id: featureId, // Ensure ID is in properties so MapLibre preserves it
        first_tag: firstTag,
      },
    });
  }

  return {
    ...geojson,
    features: enrichedFeatures,
  };
}

export function getFeaturePropertyAsString(feature: RenderedMapFeature, key: string): string {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Add all project-related MapLibre sources and layers.
 * Called once from mlMap.on('load') and after every style switch.
 */
export function addProjectDataToMlMap(
  mlMap: MaplibreMap,
  lastProjectPointsGeojson: GeoJSON.FeatureCollection | null,
): void {
  // ── MVT source: project shapes + overlay footprints ───────────────────────
  mlMap.addSource("project-sources", {
    type: "vector",
    tiles: [TILE_URL],
    minzoom: 0,
    maxzoom: MVT_SOURCE_MAX_ZOOM,
    promoteId: { "overlay-footprints": "id", "project-shapes": "id" },
  });

  mlMap.addLayer({
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
  });

  // Project geometry shapes (lines/polygons) — visible from zoom 9
  mlMap.addLayer({
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
  });

  // Proposed project shapes are overlaid as dashed lines.
  mlMap.addLayer({
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
  });

  // Hover highlight for project shapes.
  mlMap.addLayer({
    id: "project-shapes-hover-fill",
    type: "fill",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "fill-color": "#ffffff",
      "fill-opacity": 0.4,
    },
  });

  mlMap.addLayer({
    id: "project-shapes-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: PROJECT_SHAPES_MIN_ZOOM,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 4,
      "line-opacity": 0.8,
    },
  });

  mlMap.addLayer({
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
      "line-color": "#ffffff",
      "line-width": 4,
      "line-opacity": 0.8,
      "line-dasharray": [2, 1.5],
    },
  });

  // Overlay footprints — permanent border outline replacing CSS box-shadow hack
  mlMap.addLayer({
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
  });

  // Proposed overlay footprints inherit proposed state from their parent project.
  mlMap.addLayer({
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
  });

  mlMap.addLayer({
    id: "overlay-footprints-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: OVERLAY_FOOTPRINTS_MIN_ZOOM,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 3.5,
      "line-opacity": 0.9,
    },
  });

  mlMap.addLayer({
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
      "line-color": "#ffffff",
      "line-width": 3.5,
      "line-opacity": 0.9,
      "line-dasharray": [2, 1.5],
    },
  });

  mlMap.addLayer({
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
  });

  // ── GeoJSON cluster source: project center coordinates ────────────────────
  const filteredGeojson = lastProjectPointsGeojson
    ? addFirstTagToProjectPointsGeojson(filterGeoJsonByTags(lastProjectPointsGeojson))
    : { type: "FeatureCollection" as const, features: [] };

  mlMap.addSource("project-points", {
    type: "geojson",
    data: filteredGeojson,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: CLUSTER_RADIUS,
    clusterProperties: buildClusterProperties(),
  });

  // Cluster circles
  mlMap.addLayer({
    id: "clusters",
    type: "circle",
    source: "project-points",
    maxzoom: CLUSTER_LAYER_MAX_ZOOM,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "case",
        // If the cluster contains ANY pending projects, color the whole thing orange to act as a beacon
        [">", ["get", "pending_count"], 0],
        "#f97316", // Tailwind orange-500
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#3b82f6", 10, "#1d4ed8", 50, "#1e3a8a"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 0.85,
    },
  });

  // Cluster hover highlight
  mlMap.addLayer({
    id: "clusters-hover",
    type: "circle",
    source: "project-points",
    maxzoom: CLUSTER_LAYER_MAX_ZOOM,
    filter: ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]],
    paint: {
      "circle-color": [
        "case",
        [">", ["get", "pending_count"], 0],
        "#fb923c", // Tailwind orange-400 (lighter for hover)
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#60a5fa", 10, "#3b82f6", 50, "#1d4ed8"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 1,
    },
  });

  // Cluster count labels
  mlMap.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "project-points",
    maxzoom: CLUSTER_LAYER_MAX_ZOOM,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#ffffff" },
  });

  // Individual unclustered points
  mlMap.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "project-points",
    filter: ["!", ["has", "point_count"]],
    maxzoom: CLUSTER_LAYER_MAX_ZOOM,
    paint: {
      "circle-color": getProjectPointColorExpression(),
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Unclustered point hover
  mlMap.addLayer({
    id: "unclustered-point-hover",
    type: "circle",
    source: "project-points",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], HOVER_NONE_ID]],
    maxzoom: CLUSTER_LAYER_MAX_ZOOM,
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "is_pending"], true],
        "#fb923c", // Tailwind orange-400 (lighter hover)
        getProjectPointColorExpression(), // Could use a lighter expression, but fallback to same for now
      ],
      "circle-radius": 8, // larger to indicate hover
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Apply current tag filters to MVT layers
  applyTagFiltersToVectorLayers(mlMap);
}
