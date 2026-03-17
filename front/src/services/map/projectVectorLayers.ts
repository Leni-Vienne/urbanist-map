import type L from "leaflet";
import type { Map as MaplibreMap, PointLike } from "maplibre-gl";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";

export const TILE_URL = `${getApiUrl()}/api/tiles/projects/{z}/{x}/{y}`;
export const CLUSTER_MAX_ZOOM = 10;
export const VECTOR_HOVER_HIT_RADIUS_PX = 6;
export const HOVER_NONE_ID = "__none__";

export const VECTOR_QUERY_LAYERS = [
  "overlay-footprints",
  "overlay-footprints-proposed-dashed",
  "project-shapes",
  "project-shapes-proposed-dashed",
] as const;

export const CLICK_QUERY_LAYERS = [
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

export function getTagColorExpression(tagExpression: any[]): any[] {
  const expression: any[] = [
    "match",
    ["downcase", ["to-string", ["coalesce", ...tagExpression, ""]]],
  ];
  for (const [tag, color] of Object.entries(PROJECT_LINE_COLOR_BY_TAG)) {
    expression.push(tag, color);
  }
  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression;
}

export function getProjectLineColorExpression(): any[] {
  return getTagColorExpression([["get", "first_tag"]]);
}

export function getProjectPointColorExpression(): any[] {
  return getTagColorExpression([["get", "first_tag"]]);
}

export function getIsProposedFilterExpression(): any[] {
  return ["any", ["==", ["get", "is_proposed"], true], ["==", ["get", "is_proposed"], 1]];
}

export function buildClusterProperties(): Record<string, any[]> {
  const clusterProperties: Record<string, any[]> = {};

  for (const tag of PROJECT_TAGS) {
    clusterProperties[`tag_${tag.slug}`] = [
      "+",
      ["case", ["==", ["downcase", ["to-string", ["get", "first_tag"]]], tag.slug], 1, 0],
    ];
  }

  return clusterProperties;
}

export function getSingleProjectClusterColorExpression(): any[] {
  const expression: any[] = ["case"];

  for (const tag of PROJECT_TAGS) {
    expression.push(["==", ["get", `tag_${tag.slug}`], 1], tag.color);
  }

  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression;
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
  const m = mlMap as any;

  m.setFilter("project-shapes-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  m.setFilter("project-shapes-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
  m.setFilter("overlay-footprints-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  m.setFilter("overlay-footprints-proposed-hover", [
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
  (mlMap as any).setFilter("clusters-hover", [
    "all",
    ["has", "point_count"],
    ["==", ["get", "cluster_id"], clusterId ?? -1],
  ]);
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

    mlMap.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));
  });

  map.value.on("mouseout", () => {
    const mlMap = mlMapGetter();
    if (!mlMap) return;

    mlMap.getCanvas().style.cursor = "";
    setVectorHoverFilters(mlMap, null);
    setClusterHoverFilter(mlMap, null);
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
          map.value?.flyTo([lat, lng], targetZoom);
        }
      } catch (err) {
        console.error("Error getting cluster expansion zoom:", err);
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
        void handleProjectClickFromTile(projectId, event.latlng);
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
    const existingFirstTag = featureProps["first_tag"];
    const tags = Array.isArray(featureProps["tags"])
      ? (featureProps["tags"] as unknown[])
      : ([] as unknown[]);
    const firstTagFromTags = typeof tags[0] === "string" ? String(tags[0]) : "";

    const firstTag =
      typeof existingFirstTag === "string" && existingFirstTag.length > 0
        ? existingFirstTag
        : firstTagFromTags;

    enrichedFeatures.push({
      ...feature,
      properties: {
        ...featureProps,
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
  // Cast to any for addLayer/addSource calls that use complex expression arrays
  // which don't satisfy MapLibre's strict ExpressionSpecification type.
  const m = mlMap as any;

  // ── MVT source: project shapes + overlay footprints ───────────────────────
  m.addSource("project-sources", {
    type: "vector",
    tiles: [TILE_URL],
    minzoom: 0,
    maxzoom: 14,
    promoteId: { "overlay-footprints": "id", "project-shapes": "id" },
  });

  // Project geometry shapes (lines/polygons) — visible from zoom 9
  m.addLayer({
    id: "project-shapes",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 2,
      "line-dasharray": [4, 1.5],
    },
  });

  // Proposed project shapes are overlaid as dashed lines.
  m.addLayer({
    id: "project-shapes-proposed-dashed",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    filter: getIsProposedFilterExpression(),
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 2,
      "line-dasharray": [2, 1.5],
    },
  });

  // Hover highlight for project shapes.
  m.addLayer({
    id: "project-shapes-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 4,
      "line-opacity": 0.8,
    },
  });

  m.addLayer({
    id: "project-shapes-proposed-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
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
  m.addLayer({
    id: "overlay-footprints",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });

  // Proposed overlay footprints inherit proposed state from their parent project.
  m.addLayer({
    id: "overlay-footprints-proposed-dashed",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    filter: getIsProposedFilterExpression(),
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 1.5,
      "line-opacity": 0.7,
      "line-dasharray": [2, 1.5],
    },
  });

  m.addLayer({
    id: "overlay-footprints-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 3.5,
      "line-opacity": 0.9,
    },
  });

  m.addLayer({
    id: "overlay-footprints-proposed-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
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

  // ── GeoJSON cluster source: project center coordinates ────────────────────
  m.addSource("project-points", {
    type: "geojson",
    data: lastProjectPointsGeojson
      ? addFirstTagToProjectPointsGeojson(lastProjectPointsGeojson)
      : { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 50,
    clusterProperties: buildClusterProperties(),
  });

  // Cluster circles
  m.addLayer({
    id: "clusters",
    type: "circle",
    source: "project-points",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#3b82f6", 10, "#1d4ed8", 50, "#1e3a8a"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 0.85,
    },
  });

  // Cluster hover highlight
  m.addLayer({
    id: "clusters-hover",
    type: "circle",
    source: "project-points",
    filter: ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]],
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#60a5fa", 10, "#3b82f6", 50, "#1d4ed8"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 1,
    },
  });

  // Cluster count labels
  m.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "project-points",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#ffffff" },
  });

  // Individual unclustered points
  m.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "project-points",
    filter: ["!", ["has", "point_count"]],
    minzoom: CLUSTER_MAX_ZOOM,
    paint: {
      "circle-color": getProjectPointColorExpression(),
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}
