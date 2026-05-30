import { type ExpressionSpecification, type MapMouseEvent, LngLatBounds } from "maplibre-gl";
import type { Feature } from "geojson";
import type { Project } from "@/types/index";
import { map } from "@/services/core/map";
import { markerColors } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { selectProject } from "@/services/map/projectSelection";
import { suppressPopupCloseForClick } from "@/services/map/projectPopupTeleport";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/overlaySelection";
import { forEachPosition } from "@/utils/geojson";
import {
  setShapeEntry,
  hasProjectShapes,
  highlightProjectShapes,
  unhighlightProjectShapes,
  clearAllShapeEntries,
  setProjectShapesVisible,
  type ShapeEntry,
  type ShapeEventBinding,
} from "@/services/map/shapeLayerRegistry";
import {
  SHAPE_LINE_WIDTH,
  SHAPE_LINE_WIDTH_HOVER,
  SHAPE_LONG_DASH,
  SHAPE_SHORT_DASH,
} from "@/services/map/shapeStyleConstants";

type MapLibreMap = NonNullable<typeof map.value>;

const PREVIEW_COLORS = {
  current: "#22c55e", // green-500, matches "success" severity button
  suggested: "#f59e0b", // amber-500, matches "warn" severity button
} as const;

const HOVER_FILL_OPACITY = 0.35;

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

/** Combined bounds of a collection's line/polygon geometries (points excluded), or null. */
export function computeShapeBounds(geometries: GeoJSON.Geometry[]): LngLatBounds | null {
  let bounds: LngLatBounds | null = null;
  for (const geometry of geometries) {
    if (geometry.type === "Point" || geometry.type === "MultiPoint") continue;
    forEachPosition(geometry, (lng, lat) => {
      if (bounds) bounds.extend([lng, lat]);
      else bounds = new LngLatBounds([lng, lat], [lng, lat]);
    });
  }
  return bounds;
}

// Dash pattern + line-cap matching the view-mode MVT styling for each timeline status.
function lineLayoutAndDash(timelineStatus: Project["timelineStatus"]): {
  cap: "butt" | "round";
  dash: [number, number] | null;
  opacity: number;
} {
  if (timelineStatus === "completed") return { cap: "round", dash: null, opacity: 1 };
  if (timelineStatus === "proposed") return { cap: "round", dash: SHAPE_SHORT_DASH, opacity: 0.9 };
  return { cap: "butt", dash: SHAPE_LONG_DASH, opacity: 1 };
}

function shapeSourceId(projectId: string): string {
  return `project-shape-${projectId}`;
}

function isProjectFocused(projectId: string): boolean {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();
  const selected = overlayStore.idSelectedOverlay
    ? overlayStore.overlays[overlayStore.idSelectedOverlay]
    : null;
  const highlightedId =
    selected?.projectId ??
    (uiStore.projectInfoPopup.visible ? uiStore.projectInfoPopup.projectId : null);
  return highlightedId === projectId;
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

// Add the geojson source plus the fill / line / transparent-hit layers shared by the
// project-shape and change-request-preview renderers. The transparent hit line is wide so
// thin lines are easy to click.
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
      paint: { "fill-color": style.color, "fill-opacity": style.fillOpacity },
    });
    layerIds.push(fillLayerId);
  }

  mlMap.addLayer({
    id: lineLayerId,
    type: "line",
    source: sourceId,
    layout: { "line-cap": style.lineCap },
    paint: {
      "line-color": style.color,
      "line-width": style.lineWidth,
      ...(style.lineOpacity === undefined ? {} : { "line-opacity": style.lineOpacity }),
      ...(style.lineDash ? { "line-dasharray": style.lineDash } : {}),
    },
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

// Wire hover/click on the interaction layers (fill for polygons, transparent hit line for lines).
// Click routes through suppressPopupCloseForClick so the canvas-level popup-close handler does not
// close the popup we are about to open (same gotcha as the Phase-3 marker port).
function wireShapeInteraction(
  project: Project,
  fillLayerId: string | null,
  hitLayerId: string | null,
): ShapeEventBinding[] {
  const mlMap = map.value;
  if (!mlMap) return [];

  // When a line crosses this project's own polygon, one click hits both the fill and hit
  // layers, firing onClick twice. selectProject toggles, so guard on the source DOM event.
  let lastClickTimeStamp = -1;

  function onEnter(): void {
    highlightProjectShapes(project.id);
    highlightProject(project.id);
    mlMap.getCanvas().style.cursor = "pointer";
  }
  function onLeave(): void {
    mlMap.getCanvas().style.cursor = "";
    if (isProjectFocused(project.id)) return;
    unhighlightProjectShapes(project.id);
    removeProjectOutlines(project.id);
  }
  function onClick(e: MapMouseEvent): void {
    if (e.originalEvent.timeStamp === lastClickTimeStamp) return;
    lastClickTimeStamp = e.originalEvent.timeStamp;
    suppressPopupCloseForClick();
    selectProject(project, e.lngLat);
  }

  return bindLayerEvents(mlMap, [fillLayerId, hitLayerId], { onEnter, onLeave, onClick });
}

/**
 * Render a project's GeometryCollection as MapLibre layers. Idempotent: a project already in the
 * registry is skipped. Lines/polygon outlines share one line layer, polygons add a fill layer, and
 * line geometries get a transparent wide hit layer so thin lines are easy to click.
 */
export function renderProjectShapes(
  project: Project,
  colorKeyOverride?: keyof typeof markerColors,
): void {
  if (!project.geometry?.geometries.length) return;
  if (hasProjectShapes(project.id)) return;

  const mlMap = map.value;
  if (!mlMap) return;

  const features = toShapeFeatures(project.geometry.geometries);
  if (features.length === 0) return;

  const mapStore = useMapStore();
  const color = markerColors[colorKeyOverride ?? getProjectMarkerColor(project, mapStore.mode)];
  const { cap, dash, opacity } = lineLayoutAndDash(project.timelineStatus);
  const baseFillOpacity = project.timelineStatus === "proposed" ? 0.05 : 0.2;

  const sourceId = shapeSourceId(project.id);
  const { layerIds, lineLayerId, fillLayerId, hitLayerId } = buildShapeLayers(
    mlMap,
    sourceId,
    features,
    {
      color,
      fillOpacity: baseFillOpacity,
      lineCap: cap,
      lineWidth: SHAPE_LINE_WIDTH,
      lineOpacity: opacity,
      lineDash: dash,
    },
  );

  const eventBindings = wireShapeInteraction(project, fillLayerId, hitLayerId);

  const entry: ShapeEntry = {
    sourceId,
    layerIds,
    lineLayerId,
    fillLayerId,
    baseLineWidth: SHAPE_LINE_WIDTH,
    hoverLineWidth: SHAPE_LINE_WIDTH_HOVER,
    baseFillOpacity,
    hoverFillOpacity: HOVER_FILL_OPACITY,
    bounds: computeShapeBounds(project.geometry.geometries),
    eventBindings,
  };
  setShapeEntry(project.id, entry);

  // Apply hover style immediately if the project is already focused (e.g. shapes
  // re-rendered after a mode switch while the popup is open).
  if (isProjectFocused(project.id)) highlightProjectShapes(project.id);
}

/** Remove all rendered shape layers and any active preview. */
export function clearAllProjectShapes(): void {
  clearAllShapeEntries();
  clearPreviewShapes();
}

// ── Change-request preview (ephemeral, not registered in the shape registry) ──────────

interface PreviewState {
  sourceId: string;
  layerIds: string[];
  eventBindings: ShapeEventBinding[];
}

let preview: PreviewState | null = null;
// The project whose regular shapes are temporarily hidden during preview.
let previewHiddenProjectId: string | null = null;

/**
 * Render a GeometryCollection as a temporary preview (dashed, colored by variant).
 * Not registered in the shape registry, call clearPreviewShapes() to remove.
 */
export function renderPreviewShapes(
  geometry: GeoJSON.GeometryCollection,
  variant: "current" | "suggested",
  projectId?: string,
  onShapeClick?: (latlng: { lat: number; lng: number }) => void,
): void {
  clearPreviewShapes();

  const mlMap = map.value;
  if (!mlMap) return;

  // Temporarily hide this project's regular shapes so they don't overlap the preview.
  if (projectId) {
    setProjectShapesVisible(projectId, false);
    previewHiddenProjectId = projectId;
  }

  const features = toShapeFeatures(geometry.geometries);

  const sourceId = `shape-preview-${variant}`;
  const { layerIds, lineLayerId, fillLayerId, hitLayerId } = buildShapeLayers(
    mlMap,
    sourceId,
    features,
    {
      color: PREVIEW_COLORS[variant],
      fillOpacity: 0.2,
      lineCap: "round",
      lineWidth: 4,
      // Dash pattern in line-widths (2 on, 1.25 off).
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
  const mlMap = map.value;
  if (!mlMap) return [];

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

/** Remove the preview layers and restore any hidden project shapes. */
function clearPreviewShapes(): void {
  const mlMap = map.value;
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

  if (previewHiddenProjectId) {
    setProjectShapesVisible(previewHiddenProjectId, true);
    previewHiddenProjectId = null;
  }
}
