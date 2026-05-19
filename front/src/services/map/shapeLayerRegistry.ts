import L from "leaflet";

export type ShapeEntry = {
  group: L.LayerGroup;
  /** Visual layers, the ones that get styled on hover/highlight. */
  layers: L.Path[];
  /** Interactive layers, the ones that receive mouse events (transparent hit targets for lines, visual layers for polygons). */
  interactiveLayers: L.Path[];
  baseStyle: L.PathOptions;
  hoverStyle: L.PathOptions;
};

// Single source of truth for rendered project-shape Leaflet groups.
// Kept as a leaf so anything that needs to read/highlight/clear shape layers can
// import here without pulling in shapeRendering (and its selection deps).
const shapeLayerMap = new Map<string, ShapeEntry>();

export function setShapeEntry(projectId: string, entry: ShapeEntry): void {
  shapeLayerMap.set(projectId, entry);
}

export function getShapeEntry(projectId: string): ShapeEntry | undefined {
  return shapeLayerMap.get(projectId);
}

export function hasProjectShapes(projectId: string): boolean {
  return shapeLayerMap.has(projectId);
}

/** Remove rendered shape layers for a single project. */
export function clearProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (entry) {
    entry.group.remove();
    shapeLayerMap.delete(projectId);
  }
}

/** Remove all rendered shape layers. Preview state (in shapeRendering) is cleared separately. */
export function clearAllShapeEntries(): void {
  for (const entry of shapeLayerMap.values()) {
    entry.group.remove();
  }
  shapeLayerMap.clear();
}

/** Returns the combined LatLngBounds of all rendered shape layers, or null if none exist. */
export function getProjectShapeBounds(projectId: string): L.LatLngBounds | null {
  const entry = shapeLayerMap.get(projectId);
  if (!entry || entry.layers.length === 0) return null;
  let bounds: L.LatLngBounds | null = null;
  for (const layer of entry.layers) {
    const layerBounds = layer instanceof L.Polyline ? layer.getBounds() : undefined;
    if (layerBounds?.isValid()) {
      bounds = bounds ? bounds.extend(layerBounds) : layerBounds;
    }
  }
  return bounds?.isValid() ? bounds : null;
}

/** Apply the hover style to all shape layers of a project. */
export function highlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (!entry) return;
  for (const layer of entry.layers) {
    layer.setStyle(entry.hoverStyle);
  }
}

/** Revert all shape layers of a project to their base style. */
export function unhighlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (!entry) return;
  for (const layer of entry.layers) {
    layer.setStyle(entry.baseStyle);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
