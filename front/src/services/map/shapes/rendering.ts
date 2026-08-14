import type { ExpressionSpecification, LineLayerSpecification, MapMouseEvent } from "maplibre-gl";
import type { Feature } from "geojson";
import type { Project } from "@/types/index";
import { getMap, getMapOrNull } from "@/services/core/map";
import { SHAPE_LINE_WIDTH } from "@/services/map/shapes/styleConstants";
import { getProjectTagColor } from "@/constants/projectTags";

type MapLibreMap = ReturnType<typeof getMap>;
type ShapeMapEvent = "click" | "mouseenter" | "mouseleave";

interface ShapeEventBinding {
  type: ShapeMapEvent;
  layerId: string;
  handler: (e: MapMouseEvent) => void;
}

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

interface ShapeLayerIds {
  layerIds: string[];
  lineLayerId: string;
  // null when the geometry collection has no polygon / no line.
  fillLayerId: string | null;
  hitLayerId: string | null;
}

// Add the preview source plus fill, line and transparent-hit layers. The transparent line is wide
// so thin geometry remains easy to click.
function buildShapeLayers(
  mlMap: MapLibreMap,
  sourceId: string,
  features: Feature[],
  style: ShapeLayerStyle,
): ShapeLayerIds {
  const lineLayerId = `${sourceId}-line`;
  const fillLayerId = `${sourceId}-fill`;
  const hitLayerId = `${sourceId}-hit`;

  const hasPolygon = features.some((f) => isPolygonGeometry(f.geometry.type));
  const hasLine = features.some((f) => isLineGeometry(f.geometry.type));

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

  if (hasLine) {
    mlMap.addLayer({
      id: hitLayerId,
      type: "line",
      source: sourceId,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#000000", "line-width": 20, "line-opacity": 0 },
    });
    layerIds.push(hitLayerId);
  }

  return {
    layerIds,
    lineLayerId,
    fillLayerId: hasPolygon ? fillLayerId : null,
    hitLayerId: hasLine ? hitLayerId : null,
  };
}

interface ShapeEventHandlers {
  onEnter: () => void;
  onLeave: () => void;
  onClick: (e: MapMouseEvent) => void;
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

// Register hover/click handlers on each non-null layer and return the bindings needed to
// detach them later.
function bindLayerEvents(
  mlMap: MapLibreMap,
  layerIds: (string | null)[],
  handlers: ShapeEventHandlers,
): ShapeEventBinding[] {
  const bindings: ShapeEventBinding[] = [];
  for (const layerId of layerIds) {
    if (!layerId) continue;
    mlMap.on("mouseenter", layerId, handlers.onEnter);
    mlMap.on("mouseleave", layerId, handlers.onLeave);
    mlMap.on("click", layerId, handlers.onClick);
    bindings.push(
      { type: "mouseenter", layerId, handler: handlers.onEnter },
      { type: "mouseleave", layerId, handler: handlers.onLeave },
      { type: "click", layerId, handler: handlers.onClick },
    );
  }
  return bindings;
}

interface PreviewState {
  sourceId: string;
  layerIds: string[];
  eventBindings: ShapeEventBinding[];
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
  onShapeClick?: (latlng: { lat: number; lng: number }) => void,
): void {
  clearPreviewShapes();

  const mlMap = getMap();
  const color = getProjectTagColor(project.tags);
  const features = buildFeatureDiff(newGeometry, oldGeometry, color);
  if (features.length === 0) return;

  const sourceId = `shape-preview`;
  const { layerIds, lineLayerId, fillLayerId, hitLayerId } = buildShapeLayers(
    mlMap,
    sourceId,
    features,
    {
      color,
      fillOpacity: 0.2,
      lineCap: "round",
      lineWidth: SHAPE_LINE_WIDTH,
      lineDash: [2, 1.25],
    },
  );

  const eventBindings = onShapeClick
    ? wirePreviewInteraction(lineLayerId, fillLayerId, hitLayerId, onShapeClick)
    : [];

  preview = { sourceId, layerIds, eventBindings };
}

function wirePreviewInteraction(
  lineLayerId: string,
  fillLayerId: string | null,
  hitLayerId: string | null,
  onShapeClick: (latlng: { lat: number; lng: number }) => void,
): ShapeEventBinding[] {
  const mlMap = getMap();
  function onEnter(): void {
    mlMap.getCanvas().style.cursor = "pointer";
    if (mlMap.getLayer(lineLayerId)) mlMap.setPaintProperty(lineLayerId, "line-width", 6);
  }
  function onLeave(): void {
    mlMap.getCanvas().style.cursor = "";
    if (mlMap.getLayer(lineLayerId)) mlMap.setPaintProperty(lineLayerId, "line-width", 4);
  }
  function onClick(e: MapMouseEvent): void {
    onShapeClick(e.lngLat);
  }

  return bindLayerEvents(mlMap, [fillLayerId, hitLayerId], { onEnter, onLeave, onClick });
}

/** Remove the temporary preview layers. */
export function clearPreviewShapes(): void {
  const mlMap = getMapOrNull();
  if (preview && mlMap) {
    for (const binding of preview.eventBindings) {
      mlMap.off(binding.type, binding.layerId, binding.handler);
    }
    for (const layerId of preview.layerIds) {
      if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
    }
    if (mlMap.getSource(preview.sourceId)) mlMap.removeSource(preview.sourceId);
  }
  preview = null;
}
