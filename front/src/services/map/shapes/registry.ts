import type { ExpressionSpecification, MapMouseEvent, LngLatBounds } from "maplibre-gl";
import { map } from "@/services/core/map";

type ShapeMapEvent = "click" | "mouseenter" | "mouseleave";

/** A MapLibre layer-scoped listener kept on the entry so it can be removed on clear. */
export interface ShapeEventBinding {
  type: ShapeMapEvent;
  layerId: string;
  handler: (e: MapMouseEvent) => void;
}

export interface ShapeEntry {
  sourceId: string;
  /** All layer ids belonging to this entry, in removal order (hit, fill, line). */
  layerIds: string[];
  lineLayerId: string;
  fillLayerId: string | null;
  baseLineWidth: ExpressionSpecification | number;
  hoverLineWidth: ExpressionSpecification | number;
  baseFillOpacity: number;
  hoverFillOpacity: number;
  bounds: LngLatBounds | null;
  eventBindings: ShapeEventBinding[];
}

// Single source of truth for rendered project-shape MapLibre layers/sources.
// Kept as a leaf so anything that needs to read/highlight/clear shape layers can
// import here without pulling in shapeRendering (and its selection deps).
const shapeLayerMap = new Map<string, ShapeEntry>();

export function setShapeEntry(projectId: string, entry: ShapeEntry): void {
  shapeLayerMap.set(projectId, entry);
}

export function hasProjectShapes(projectId: string): boolean {
  return shapeLayerMap.has(projectId);
}

function removeEntryFromMap(entry: ShapeEntry): void {
  const mlMap = map.value;
  for (const binding of entry.eventBindings) {
    mlMap.off(binding.type, binding.layerId, binding.handler);
  }
  for (const layerId of entry.layerIds) {
    if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
  }
  if (mlMap.getSource(entry.sourceId)) mlMap.removeSource(entry.sourceId);
}

/** Remove rendered shape layers for a single project. */
export function clearProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  if (entry) {
    removeEntryFromMap(entry);
    shapeLayerMap.delete(projectId);
  }
}

/** Remove all rendered shape layers. Preview state (in shapeRendering) is cleared separately. */
export function clearAllShapeEntries(): void {
  for (const entry of shapeLayerMap.values()) {
    removeEntryFromMap(entry);
  }
  shapeLayerMap.clear();
}

/** Returns the combined LngLatBounds of all rendered shape layers, or null if none exist. */
export function getProjectShapeBounds(projectId: string): LngLatBounds | null {
  return shapeLayerMap.get(projectId)?.bounds ?? null;
}

/** Apply the hover style to a project's shape layers. No-op when no entry exists. */
export function highlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  const mlMap = map.value;
  if (!entry) return;
  if (mlMap.getLayer(entry.lineLayerId)) {
    mlMap.setPaintProperty(entry.lineLayerId, "line-width", entry.hoverLineWidth);
  }
  if (entry.fillLayerId && mlMap.getLayer(entry.fillLayerId)) {
    mlMap.setPaintProperty(entry.fillLayerId, "fill-opacity", entry.hoverFillOpacity);
  }
}

/** Revert a project's shape layers to their base style. No-op when no entry exists. */
export function unhighlightProjectShapes(projectId: string): void {
  const entry = shapeLayerMap.get(projectId);
  const mlMap = map.value;
  if (!entry) return;
  if (mlMap.getLayer(entry.lineLayerId)) {
    mlMap.setPaintProperty(entry.lineLayerId, "line-width", entry.baseLineWidth);
  }
  if (entry.fillLayerId && mlMap.getLayer(entry.fillLayerId)) {
    mlMap.setPaintProperty(entry.fillLayerId, "fill-opacity", entry.baseFillOpacity);
  }
}

/** Show/hide a project's shape layers without removing them (used while previewing a change). */
export function setProjectShapesVisible(projectId: string, visible: boolean): void {
  const entry = shapeLayerMap.get(projectId);
  const mlMap = map.value;
  if (!entry) return;
  for (const layerId of entry.layerIds) {
    if (mlMap.getLayer(layerId)) {
      mlMap.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }
}
