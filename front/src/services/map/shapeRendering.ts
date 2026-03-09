import L from "leaflet";
import type { Project } from "@/types/index";
import { markerColors } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { useMapStore } from "@/stores/pinia/mapStore";

// Registry: projectId → LayerGroup of rendered shapes
const shapeLayerMap = new Map<string, L.LayerGroup>();

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

  const layers: L.Path[] = [];

  for (const geom of project.geometry.geometries) {
    if (geom.type === "LineString") {
      const coords = (geom.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as L.LatLngTuple,
      );
      layers.push(L.polyline(coords, baseStyle));
    } else if (geom.type === "MultiLineString") {
      const latlngs = (geom.coordinates as [number, number][][]).map((line) =>
        line.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      layers.push(L.polyline(latlngs, baseStyle));
    } else if (geom.type === "Polygon") {
      const rings = (geom.coordinates as [number, number][][]).map((ring) =>
        ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      );
      layers.push(L.polygon(rings, { ...baseStyle, fillOpacity: 0.15 }));
    } else if (geom.type === "MultiPolygon") {
      const polys = (geom.coordinates as [number, number][][][]).map((poly) =>
        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)),
      );
      layers.push(L.polygon(polys, { ...baseStyle, fillOpacity: 0.15 }));
    }
  }

  if (layers.length === 0) return;

  for (const layer of layers) {
    layer.on("mouseover", () => {
      layer.setStyle(hoverStyle);
      layer.getElement()?.style.setProperty("cursor", "pointer");
    });
    layer.on("mouseout", () => {
      layer.setStyle(baseStyle);
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
 * Remove all rendered shape layers.
 */
export function clearAllProjectShapes(): void {
  for (const group of shapeLayerMap.values()) {
    group.remove();
  }
  shapeLayerMap.clear();
}

/**
 * Check if shapes are already rendered for a project.
 */
export function hasProjectShapes(projectId: string): boolean {
  return shapeLayerMap.has(projectId);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
