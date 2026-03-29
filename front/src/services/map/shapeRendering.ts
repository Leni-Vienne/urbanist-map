import L from "leaflet";
import type { Project } from "@/types/index";
import { markerColors } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";

type ShapeEntry = {
  group: L.LayerGroup;
  /** Visual layers — the ones that get styled on hover/highlight. */
  layers: L.Path[];
  /** Interactive layers — the ones that receive mouse events (transparent hit targets for lines, visual layers for polygons). */
  interactiveLayers: L.Path[];
  baseStyle: L.PathOptions;
  hoverStyle: L.PathOptions;
};

// Registry: projectId → shape entry with layers and styles for highlight/unhighlight
const shapeLayerMap = new Map<string, ShapeEntry>();

// Ephemeral preview layer for change request previews (not in shapeLayerMap)
let previewLayerGroup: L.LayerGroup | null = null;
// The project whose regular shapes are temporarily hidden during preview
let previewHiddenProjectId: string | null = null;
let previewMapInstance: L.Map | null = null;

const PREVIEW_COLORS = {
  current: "#22c55e", // green-500 — matches "success" severity button
  suggested: "#f59e0b", // amber-500 — matches "warn" severity button
} as const;

/**
 * Build Leaflet path layers from a GeometryCollection.
 * Lines use `style` directly; polygons add `fillOpacity`.
 * Point/MultiPoint intentionally excluded — city boundaries are always line/polygon geometry.
 *
 * For line geometries a transparent wide polyline is added as a hit target so lines
 * are easy to click without changing their visual weight.
 */
function buildShapeLayers(
  geometries: GeoJSON.Geometry[],
  style: L.PathOptions,
  fillOpacity: number,
): { visual: L.Path[]; interactive: L.Path[] } {
  const visual: L.Path[] = [];
  const interactive: L.Path[] = [];
  const polygonStyle = { ...style, fillOpacity };
  // Transparent wide polyline used as a click/hover target for lines.
  const hitStyle: L.PathOptions = { opacity: 0, fillOpacity: 0, weight: 20, stroke: true };

  // oxlint-disable no-unsafe-type-assertion
  for (const geom of geometries) {
    if (geom.type === "LineString") {
      const coords = (geom.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as L.LatLngTuple,
      );
      visual.push(L.polyline(coords, { ...style, interactive: false }));
      interactive.push(L.polyline(coords, hitStyle));
    } else if (geom.type === "MultiLineString") {
      const latlngs = (geom.coordinates as [number, number][][]).map((line) =>
        line.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      visual.push(L.polyline(latlngs, { ...style, interactive: false }));
      interactive.push(L.polyline(latlngs, hitStyle));
    } else if (geom.type === "Polygon") {
      const rings = (geom.coordinates as [number, number][][]).map((ring) =>
        ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      const layer = L.polygon(rings, polygonStyle);
      visual.push(layer);
      interactive.push(layer); // polygons have a large area, no separate hit layer needed
    } else if (geom.type === "MultiPolygon") {
      const polys = (geom.coordinates as [number, number][][][]).map((poly) =>
        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)),
      );
      const layer = L.polygon(polys, polygonStyle);
      visual.push(layer);
      interactive.push(layer);
    }
  }
  // oxlint-enable no-unsafe-type-assertion
  return { visual, interactive };
}

/**
 * Render a project's GeometryCollection as Leaflet layers on the map.
 * Lines become L.polyline, polygons become L.polygon (with fill).
 * Idempotent — if already rendered, does nothing.
 * onProjectClick: called when the user clicks any shape layer.
 * onProjectHover / onProjectLeave: called with projectId on enter/leave — use to highlight sister overlays.
 */
export function renderProjectShapes(
  project: Project,
  mapInstance: L.Map,
  onProjectClick?: (project: Project, latlng: L.LatLng) => void,
  onProjectHover?: (projectId: string) => void,
  onProjectLeave?: (projectId: string) => void,
  colorKeyOverride?: keyof typeof markerColors,
): void {
  if (!project.geometry?.geometries.length) return;
  if (shapeLayerMap.has(project.id)) return;

  const mapStore = useMapStore();
  const color = markerColors[colorKeyOverride ?? getProjectMarkerColor(project, mapStore.mode)];

  const baseStyle: L.PathOptions = { color, weight: 3, opacity: 0.85 };
  const hoverStyle: L.PathOptions = { color, weight: 5, opacity: 1 };

  const { visual: layers, interactive: interactiveLayers } = buildShapeLayers(
    project.geometry.geometries,
    baseStyle,
    0.15,
  );

  if (layers.length === 0) return;

  for (const layer of interactiveLayers) {
    layer.on("mouseover", () => {
      highlightProjectShapes(project.id);
      onProjectHover?.(project.id);
      (layer.getElement() as HTMLElement | undefined)?.style.setProperty("cursor", "pointer");
    });
    layer.on("mouseout", () => {
      // Don't unhighlight if this project is currently persistently highlighted
      // (project info popup open or an overlay of this project is selected).
      // NOTE: intentionally NOT using getCurrentHighlightedProjectId() from overlaySelection,
      // importing it here would create a circular dependency (overlaySelection → shapeRendering → overlaySelection).
      const overlayStore = useOverlayStore();
      const uiStore = useUiStore();
      const selected = overlayStore.idSelectedOverlay
        ? overlayStore.overlays[overlayStore.idSelectedOverlay]
        : null;
      const highlightedId =
        selected?.projectId ??
        (uiStore.projectInfoPopup.visible ? uiStore.projectInfoPopup.projectId : null);
      if (highlightedId === project.id) return;

      unhighlightProjectShapes(project.id);
      onProjectLeave?.(project.id);
      (layer.getElement() as HTMLElement | undefined)?.style.removeProperty("cursor");
    });
    if (onProjectClick) {
      layer.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onProjectClick(project, e.latlng);
      });
    }
  }

  const group = L.layerGroup([...layers, ...interactiveLayers]);
  group.addTo(mapInstance);
  shapeLayerMap.set(project.id, { group, layers, interactiveLayers, baseStyle, hoverStyle });

  // If this project is currently highlighted (via overlay selection or project info popup),
  // apply hover style immediately — covers the timing case where shapes are re-rendered
  // after a mode switch while the project is already focused.
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();
  const selected = overlayStore.idSelectedOverlay
    ? overlayStore.overlays[overlayStore.idSelectedOverlay]
    : null;
  const highlightedProjectId =
    selected?.projectId ??
    (uiStore.projectInfoPopup.visible ? uiStore.projectInfoPopup.projectId : null);
  if (highlightedProjectId === project.id) {
    highlightProjectShapes(project.id);
  }
}

/**
 * Remove rendered shape layers for a single project.
 * Allows re-rendering after geometry changes (e.g. after saving in shape editor).
 */
export function clearProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (entry) {
    entry.group.remove();
    shapeLayerMap.delete(projectId);
  }
}

/**
 * Remove all rendered shape layers (and any active preview).
 */
export function clearAllProjectShapes(): void {
  for (const entry of shapeLayerMap.values()) {
    entry.group.remove();
  }
  shapeLayerMap.clear();
  clearPreviewShapes();
}

/**
 * Check if shapes are already rendered for a project.
 */
export function hasProjectShapes(projectId: string): boolean {
  return shapeLayerMap.has(projectId);
}

/**
 * Return the combined LatLngBounds of all rendered shape layers for a project.
 * Returns null if the project has no rendered shapes or bounds are invalid.
 */
export function getProjectShapeBounds(projectId: string): L.LatLngBounds | null {
  const entry = shapeLayerMap.get(projectId);
  if (!entry || entry.layers.length === 0) return null;
  let bounds: L.LatLngBounds | null = null;
  for (const layer of entry.layers) {
    const layerBounds = (layer as L.Polyline).getBounds?.();
    if (layerBounds?.isValid()) {
      bounds = bounds ? bounds.extend(layerBounds) : layerBounds;
    }
  }
  return bounds?.isValid() ? bounds : null;
}

/**
 * Apply the hover style to all shape layers of a project (e.g. when an overlay is hovered).
 */
export function highlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (!entry) return;
  for (const layer of entry.layers) {
    layer.setStyle(entry.hoverStyle);
  }
}

/**
 * Revert all shape layers of a project to their base style.
 */
export function unhighlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (!entry) return;
  for (const layer of entry.layers) {
    layer.setStyle(entry.baseStyle);
  }
}

/**
 * Render a GeometryCollection as a temporary preview layer (dashed, colored by variant).
 * Not registered in shapeLayerMap — call clearPreviewShapes() to remove.
 */
export function renderPreviewShapes(
  geometry: GeoJSON.GeometryCollection,
  mapInstance: L.Map,
  variant: "current" | "suggested",
  projectId?: string,
  onShapeClick?: (latlng: L.LatLng) => void,
): void {
  clearPreviewShapes();

  // Temporarily hide this project's regular shapes so they don't overlap the preview
  previewMapInstance = mapInstance;
  if (projectId) {
    const existingEntry = shapeLayerMap.get(projectId);
    if (existingEntry) {
      existingEntry.group.remove();
    }
    previewHiddenProjectId = projectId;
  }

  const color = PREVIEW_COLORS[variant];
  const baseStyle = { color, weight: 4, opacity: 1, dashArray: "8 5" };
  const hoverStyle = { weight: 6, opacity: 1 };

  const { visual, interactive } = buildShapeLayers(geometry.geometries, baseStyle, 0.2);

  if (visual.length === 0) return;

  if (onShapeClick) {
    // visual[k] and interactive[k] are paired: for lines interactive[k] is the hit target,
    // for polygons they are the same object.
    for (const [k, hitLayer] of interactive.entries()) {
      const visualLayer = visual[k];
      if (!hitLayer || !visualLayer) continue;
      hitLayer.on("mouseover", () => {
        visualLayer.setStyle(hoverStyle);
        (hitLayer.getElement() as HTMLElement | undefined)?.style.setProperty("cursor", "pointer");
      });
      hitLayer.on("mouseout", () => {
        visualLayer.setStyle(baseStyle);
        (hitLayer.getElement() as HTMLElement | undefined)?.style.removeProperty("cursor");
      });
      hitLayer.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onShapeClick(e.latlng);
      });
    }
  }

  previewLayerGroup = L.layerGroup([...visual, ...interactive]);
  previewLayerGroup.addTo(mapInstance);
}

/**
 * Remove the current preview layer group from the map.
 */
function clearPreviewShapes(): void {
  previewLayerGroup?.remove();
  previewLayerGroup = null;

  // Restore the regular shapes that were hidden during preview
  if (previewHiddenProjectId && previewMapInstance) {
    const entry = shapeLayerMap.get(previewHiddenProjectId);
    if (entry) {
      entry.group.addTo(previewMapInstance);
    }
    previewHiddenProjectId = null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
