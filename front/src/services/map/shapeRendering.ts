import L from "leaflet";
import type { Project } from "@/types/index";
import { markerColors } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { useMapStore } from "@/stores/pinia/mapStore";

// Registry: projectId → LayerGroup of rendered shapes
const shapeLayerMap = new Map<string, L.LayerGroup>();

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
 */
function buildShapeLayers(
  geometries: GeoJSON.Geometry[],
  style: L.PathOptions,
  fillOpacity: number,
): L.Path[] {
  const layers: L.Path[] = [];
  const polygonStyle = { ...style, fillOpacity };
  for (const geom of geometries) {
    if (geom.type === "LineString") {
      const coords = (geom.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as L.LatLngTuple,
      );
      layers.push(L.polyline(coords, style));
    } else if (geom.type === "MultiLineString") {
      const latlngs = (geom.coordinates as [number, number][][]).map((line) =>
        line.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      layers.push(L.polyline(latlngs, style));
    } else if (geom.type === "Polygon") {
      const rings = (geom.coordinates as [number, number][][]).map((ring) =>
        ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      layers.push(L.polygon(rings, polygonStyle));
    } else if (geom.type === "MultiPolygon") {
      const polys = (geom.coordinates as [number, number][][][]).map((poly) =>
        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)),
      );
      layers.push(L.polygon(polys, polygonStyle));
    }
  }
  return layers;
}

/**
 * Render a project's GeometryCollection as Leaflet layers on the map.
 * Lines become L.polyline, polygons become L.polygon (with fill).
 * Idempotent — if already rendered, does nothing.
 * onProjectClick: called when the user clicks any shape layer.
 */
export function renderProjectShapes(
  project: Project,
  mapInstance: L.Map,
  onProjectClick?: (project: Project, latlng: L.LatLng) => void,
): void {
  if (!project.geometry?.geometries?.length) return;
  if (shapeLayerMap.has(project.id)) return;

  const mapStore = useMapStore();
  const color = markerColors[getProjectMarkerColor(project, mapStore.mode)];

  const baseStyle = { color, weight: 3, opacity: 0.85 };
  const hoverStyle = { weight: 5, opacity: 1 };

  const layers = buildShapeLayers(project.geometry.geometries, baseStyle, 0.15);

  if (layers.length === 0) return;

  for (const layer of layers) {
    layer.on("mouseover", () => {
      layer.setStyle(hoverStyle);
      (layer.getElement() as HTMLElement | undefined)?.style.setProperty("cursor", "pointer");
    });
    layer.on("mouseout", () => {
      layer.setStyle(baseStyle);
      (layer.getElement() as HTMLElement | undefined)?.style.removeProperty("cursor");
    });
    if (onProjectClick) {
      layer.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onProjectClick(project, e.latlng);
      });
    }
  }

  const group = L.layerGroup(layers);
  group.addTo(mapInstance);
  shapeLayerMap.set(project.id, group);
}

/**
 * Remove rendered shape layers for a single project.
 * Allows re-rendering after geometry changes (e.g. after saving in shape editor).
 */
export function clearProjectShapes(projectId: string): void {
  const group = shapeLayerMap.get(projectId);
  if (group) {
    group.remove();
    shapeLayerMap.delete(projectId);
  }
}

/**
 * Remove all rendered shape layers (and any active preview).
 */
export function clearAllProjectShapes(): void {
  for (const group of shapeLayerMap.values()) {
    group.remove();
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
    const existingGroup = shapeLayerMap.get(projectId);
    if (existingGroup) {
      existingGroup.remove();
    }
    previewHiddenProjectId = projectId;
  }

  const color = PREVIEW_COLORS[variant];
  const baseStyle = { color, weight: 4, opacity: 1, dashArray: "8 5" };
  const hoverStyle = { weight: 6, opacity: 1 };

  const layers = buildShapeLayers(geometry.geometries, baseStyle, 0.2);

  if (layers.length === 0) return;

  if (onShapeClick) {
    for (const layer of layers) {
      layer.on("mouseover", () => {
        layer.setStyle(hoverStyle);
        (layer.getElement() as HTMLElement | undefined)?.style.setProperty("cursor", "pointer");
      });
      layer.on("mouseout", () => {
        layer.setStyle(baseStyle);
        (layer.getElement() as HTMLElement | undefined)?.style.removeProperty("cursor");
      });
      layer.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onShapeClick(e.latlng);
      });
    }
  }

  previewLayerGroup = L.layerGroup(layers);
  previewLayerGroup.addTo(mapInstance);
}

/**
 * Remove the current preview layer group from the map.
 */
export function clearPreviewShapes(): void {
  previewLayerGroup?.remove();
  previewLayerGroup = null;

  // Restore the regular shapes that were hidden during preview
  if (previewHiddenProjectId && previewMapInstance) {
    const group = shapeLayerMap.get(previewHiddenProjectId);
    if (group) {
      group.addTo(previewMapInstance);
    }
    previewHiddenProjectId = null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
