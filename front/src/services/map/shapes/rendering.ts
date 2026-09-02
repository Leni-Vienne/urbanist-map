import type { ExpressionSpecification, LineLayerSpecification } from "maplibre-gl";
import type { Feature } from "geojson";
import type { Project } from "@/types/index";
import { getMap, getMapOrNull } from "@/services/core/map";
import { SHAPE_LINE_WIDTH } from "@/services/map/shapes/styleConstants";
import { getProjectTagColor } from "@/constants/projectTags";

type MapLibreMap = ReturnType<typeof getMap>;
type LineGeomType = "LineString" | "MultiLineString";
type PolygonGeomType = "Polygon" | "MultiPolygon";

function isLineGeometry(type: GeoJSON.Geometry["type"]): type is LineGeomType {
  return type === "LineString" || type === "MultiLineString";
}

function isPolygonGeometry(type: GeoJSON.Geometry["type"]): type is PolygonGeomType {
  return type === "Polygon" || type === "MultiPolygon";
}

/** Wrap each line/polygon geometry as a Feature; points are ignored (rendered as markers). */
function toShapeFeatures(geometries: GeoJSON.Geometry[]): Feature[] {
  const features: Feature[] = [];
  for (const geometry of geometries) {
    if (isLineGeometry(geometry.type) || isPolygonGeometry(geometry.type)) {
      features.push({ type: "Feature", geometry, properties: {} });
    }
  }
  return features;
}

interface ShapeLayerStyle {
  color: string;
  fillOpacity: number;
  lineCap: "butt" | "round";
  lineWidth: number | ExpressionSpecification;
  lineOpacity?: number;
  // Dash pattern in line-width units, or null for a solid line.
  lineDash?: [number, number] | null;
}

// Add the preview source plus its fill and line layers.
function buildShapeLayers(
  mlMap: MapLibreMap,
  sourceId: string,
  features: Feature[],
  style: ShapeLayerStyle,
): string[] {
  const lineLayerId = `${sourceId}-line`;
  const fillLayerId = `${sourceId}-fill`;

  const hasPolygon = features.some((f) => isPolygonGeometry(f.geometry.type));

  mlMap.addSource(sourceId, {
    type: "geojson",
    data: { type: "FeatureCollection", features },
  });

  const layerIds: string[] = [];

  if (hasPolygon) {
    mlMap.addLayer({
      id: fillLayerId,
      type: "fill",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["coalesce", ["get", "color"], style.color] as ExpressionSpecification,
        "fill-opacity": [
          "coalesce",
          ["get", "fillOpacity"],
          style.fillOpacity,
        ] as ExpressionSpecification,
      },
    });
    layerIds.push(fillLayerId);
  }

  const linePaint: LineLayerSpecification["paint"] = {
    "line-color": ["coalesce", ["get", "color"], style.color] as ExpressionSpecification,
    "line-width": style.lineWidth,
    "line-opacity": [
      "coalesce",
      ["get", "opacity"],
      style.lineOpacity ?? 1,
    ] as ExpressionSpecification,
  };
  if (style.lineDash) linePaint["line-dasharray"] = style.lineDash;

  mlMap.addLayer({
    id: lineLayerId,
    type: "line",
    source: sourceId,
    layout: { "line-cap": style.lineCap },
    paint: linePaint,
  });
  layerIds.push(lineLayerId);

  return layerIds;
}

// Build the renderable features for a shape source: the new geometry colored by tag, plus,
// when an old geometry is supplied and differs, the old geometry underneath as a gray ghost.
function buildFeatureDiff(
  newGeom: GeoJSON.GeometryCollection | null | undefined,
  oldGeom: GeoJSON.GeometryCollection | null | undefined,
  color: string,
): Feature[] {
  const features: Feature[] = [];
  const hasDiff = JSON.stringify(newGeom || {}) !== JSON.stringify(oldGeom || {});

  if (oldGeom?.geometries && hasDiff) {
    const ghostFeatures = toShapeFeatures(oldGeom.geometries);
    for (const f of ghostFeatures) {
      f.properties = {
        ...f.properties,
        isGhost: true,
        color: "#9ca3af",
        opacity: 0.4,
        fillOpacity: 0.1,
      };
    }
    features.push(...ghostFeatures);
  }

  if (newGeom?.geometries) {
    const newFeatures = toShapeFeatures(newGeom.geometries);
    for (const f of newFeatures) {
      f.properties = { ...f.properties, color };
    }
    features.push(...newFeatures);
  }

  return features;
}

interface PreviewState {
  sourceId: string;
  layerIds: string[];
}

let preview: PreviewState | null = null;

/**
 * Render a temporary preview (with ghost diff).
 * Call clearPreviewShapes() to remove it.
 */
export function renderPreviewShapes(
  project: Project,
  newGeometry: GeoJSON.GeometryCollection | null,
  oldGeometry: GeoJSON.GeometryCollection | null,
): void {
  clearPreviewShapes();

  const mlMap = getMap();
  const color = getProjectTagColor(project.tags);
  const features = buildFeatureDiff(newGeometry, oldGeometry, color);
  if (features.length === 0) return;

  const sourceId = `shape-preview`;
  const layerIds = buildShapeLayers(mlMap, sourceId, features, {
    color,
    fillOpacity: 0.2,
    lineCap: "round",
    lineWidth: SHAPE_LINE_WIDTH,
    lineDash: [2, 1.25],
  });

  preview = { sourceId, layerIds };
}

/** Remove the temporary preview layers. */
export function clearPreviewShapes(): void {
  const mlMap = getMapOrNull();
  if (preview && mlMap) {
    for (const layerId of preview.layerIds) {
      if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
    }
    if (mlMap.getSource(preview.sourceId)) mlMap.removeSource(preview.sourceId);
  }
  preview = null;
}
