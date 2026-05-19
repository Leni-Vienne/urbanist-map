import L from "leaflet";
import type { Project } from "@/types/index";
import { markerColors } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { selectProject } from "@/services/map/projectSelection";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/overlaySelection";
import {
  setShapeEntry,
  getShapeEntry,
  hasProjectShapes,
  highlightProjectShapes,
  unhighlightProjectShapes,
  clearAllShapeEntries,
} from "@/services/map/shapeLayerRegistry";

// Ephemeral preview layer for change request previews (not in shapeLayerMap)
let previewLayerGroup: L.LayerGroup | null = null;
// The project whose regular shapes are temporarily hidden during preview
let previewHiddenProjectId: string | null = null;
let previewMapInstance: L.Map | null = null;

const PREVIEW_COLORS = {
  current: "#22c55e", // green-500, matches "success" severity button
  suggested: "#f59e0b", // amber-500, matches "warn" severity button
} as const;

/** Convert a GeoJSON [lng, lat] position to a Leaflet LatLng. */
function toLatLng(coord: number[]): L.LatLng {
  return L.latLng(coord[1] ?? 0, coord[0] ?? 0);
}

/**
 * Build Leaflet path layers from a GeometryCollection.
 * Lines use `style` directly; polygons add `fillOpacity`.
 * Point/MultiPoint geometries are ignored.
 *
 * For line geometries a transparent wide polyline is added as a hit target so lines
 * are easy to click without changing their visual weight.
 *
 * LineString/Polygon are normalised to their Multi variants before constructing
 * the Leaflet layer, so each geometry family has a single branch.
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

  for (const geom of geometries) {
    if (geom.type === "LineString" || geom.type === "MultiLineString") {
      const lines =
        geom.type === "LineString"
          ? [geom.coordinates.map(toLatLng)]
          : geom.coordinates.map((line) => line.map(toLatLng));
      visual.push(L.polyline(lines, { ...style, interactive: false }));
      interactive.push(L.polyline(lines, hitStyle));
    } else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
      const polys =
        geom.type === "Polygon"
          ? [geom.coordinates.map((ring) => ring.map(toLatLng))]
          : geom.coordinates.map((poly) => poly.map((ring) => ring.map(toLatLng)));
      const layer = L.polygon(polys, polygonStyle); // polygons have a large area, no separate hit layer needed
      visual.push(layer);
      interactive.push(layer);
    }
  }
  return { visual, interactive };
}

/**
 * Render a project's GeometryCollection as Leaflet layers on the map.
 * Lines become L.polyline, polygons become L.polygon (with fill). Idempotent.
 * Hover/click handlers call selectProject + highlightProject/removeProjectOutlines directly.
 */
export function renderProjectShapes(
  project: Project,
  mapInstance: L.Map,
  colorKeyOverride?: keyof typeof markerColors,
): void {
  if (!project.geometry?.geometries.length) return;
  if (hasProjectShapes(project.id)) return;

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
      highlightProject(project.id);
      (layer.getElement() as unknown as HTMLElement | undefined)?.style.setProperty(
        "cursor",
        "pointer",
      );
    });
    layer.on("mouseout", () => {
      // Keep highlight if the project info popup is open or one of its overlays is selected.
      // Inlined check to avoid coupling to overlaySelection.getCurrentHighlightedProjectId
      // beyond the existing import.
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
      removeProjectOutlines(project.id);
      (layer.getElement() as unknown as HTMLElement | undefined)?.style.removeProperty("cursor");
    });
    layer.on("click", (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      selectProject(project, e.latlng);
    });
  }

  const group = L.layerGroup([...layers, ...interactiveLayers]);
  group.addTo(mapInstance);
  setShapeEntry(project.id, { group, layers, interactiveLayers, baseStyle, hoverStyle });

  // Apply hover style immediately if the project is already focused (e.g. shapes
  // re-rendered after a mode switch while the popup is open).
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

/** Remove all rendered shape layers and any active preview. */
export function clearAllProjectShapes(): void {
  clearAllShapeEntries();
  clearPreviewShapes();
}

/**
 * Render a GeometryCollection as a temporary preview layer (dashed, colored by variant).
 * Not registered in the shape registry, call clearPreviewShapes() to remove.
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
    const existingEntry = getShapeEntry(projectId);
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
    // visual[k] and interactive[k] are paired: for lines interactive[k] is the hit target;
    // for polygons they are the same object.
    for (const [k, hitLayer] of interactive.entries()) {
      const visualLayer = visual[k];
      hitLayer.on("mouseover", () => {
        visualLayer?.setStyle(hoverStyle);
        (hitLayer.getElement() as unknown as HTMLElement | undefined)?.style.setProperty(
          "cursor",
          "pointer",
        );
      });
      hitLayer.on("mouseout", () => {
        visualLayer?.setStyle(baseStyle);
        (hitLayer.getElement() as unknown as HTMLElement | undefined)?.style.removeProperty(
          "cursor",
        );
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

/** Remove the preview layer group and restore any hidden project shapes. */
function clearPreviewShapes(): void {
  previewLayerGroup?.remove();
  previewLayerGroup = null;

  if (previewHiddenProjectId && previewMapInstance) {
    const entry = getShapeEntry(previewHiddenProjectId);
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
