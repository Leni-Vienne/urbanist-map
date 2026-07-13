// Lazy chunk, only imported when a user activates the shape editor in edit mode.
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawModeUndoRedo,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { map } from "@/services/core/map";
import { LngLatBounds } from "maplibre-gl";
import { forEachPosition } from "@/utils/geojson";
import { ref } from "vue";

const drawableGeometryTypes = new Set(["LineString", "MultiLineString", "Polygon", "MultiPolygon"]);

export type ShapeDrawMode = "linestring" | "polygon" | "select";

// Number of geometries to add per batch before yielding to the browser's event loop.
const BATCH_SIZE = 20;

type LoadedGeoJSON = {
  geometry: GeoJSON.GeometryCollection;
  skippedGeometryTypes: string[];
  featureProperties: Record<string, unknown>[];
};

function filterDrawableGeometries(
  geometries: (GeoJSON.Geometry | null | undefined)[],
  featureProperties: Record<string, unknown>[] = [],
): LoadedGeoJSON {
  const drawable: GeoJSON.Geometry[] = [];
  const skipped = new Set<string>();

  for (const geometry of geometries) {
    if (!geometry) continue;
    if (drawableGeometryTypes.has(geometry.type)) {
      drawable.push(geometry);
    } else {
      skipped.add(geometry.type);
    }
  }

  return {
    geometry: { type: "GeometryCollection", geometries: drawable },
    skippedGeometryTypes: [...skipped],
    featureProperties,
  };
}

let draw: TerraDraw | null = null;

// Id of the shape currently selected in the "select" tool, or null. Used to drive
// the delete-shape affordance, since deleting nodes can never remove a whole shape
// (Terra Draw refuses to drop a coordinate below the geometry's minimum).
export const selectedShapeId = ref<string | number | null>(null);

// Persists the last tool the user picked across editor open/close so re-entering
// the editor restores it. Null means no tool has been picked yet (Terra Draw stays
// in its default "static" mode, i.e. nothing selected).
let lastDrawMode: ShapeDrawMode | null = null;

const snappingConfig = { toLine: true, toCoordinate: true };

export function getLastDrawMode(): ShapeDrawMode | null {
  return lastDrawMode;
}

// Mouse-only undo: right-clicking while a line/polygon is being drawn removes the last
// placed node. Terra Draw's own right-click delete doesn't fire on the MapLibre adapter
// (right-clicks arrive as contextmenu, not button:"right"), so this is wired directly.
function handleDrawingRightClick(event: MouseEvent): void {
  if (!draw) return;
  const mode = draw.getMode();
  if ((mode === "linestring" || mode === "polygon") && draw.getModeState() === "drawing") {
    event.preventDefault();
    draw.undo();
  }
}

/**
 * Activate the Terra Draw editor on the map with line and polygon tools.
 * If existingGeometry is provided, the shapes are added to the map.
 */
export async function initShapeEditor(
  existingGeometry?: GeoJSON.GeometryCollection,
): Promise<void> {
  const mlMap = map.value;
  if (draw) {
    // Double-init guard: clear existing features before re-initializing.
    draw.clear();
  } else {
    // editable: drag vertices to move them, right click a vertex to delete it.
    // showCoordinatePoints: render the draggable vertex handles.
    // The select mode adds full editing of existing shapes: drag a midpoint to
    // split a segment, drag a vertex to move it, right click a vertex to delete it.
    const editCoordinateFlags = {
      feature: {
        draggable: true,
        coordinates: {
          // Nested form (not `midpoints: true`) is required to drag a midpoint to split
          // a segment in select mode; the bare boolean only enables click-to-insert.
          midpoints: { draggable: true },
          draggable: true,
          deletable: true,
          snappable: snappingConfig,
        },
      },
    };
    draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: mlMap }),
      modes: [
        new TerraDrawLineStringMode({
          editable: true,
          showCoordinatePoints: true,
          snapping: snappingConfig,
        }),
        new TerraDrawPolygonMode({
          editable: true,
          showCoordinatePoints: true,
          snapping: snappingConfig,
        }),
        new TerraDrawSelectMode({
          flags: { linestring: editCoordinateFlags, polygon: editCoordinateFlags },
        }),
      ],
      // Mode-level undo only: lets draw.undo() pop the last placed node while drawing.
      // No session level / keyboard shortcuts: undo is driven by right-click (see below).
      undoRedo: {
        modeLevel: new TerraDrawModeUndoRedo(),
      },
    });
    draw.on("select", (id) => {
      selectedShapeId.value = id;
    });
    draw.on("deselect", () => {
      selectedShapeId.value = null;
    });
    mlMap.getCanvasContainer().addEventListener("contextmenu", handleDrawingRightClick);
    draw.start();
  }

  if (existingGeometry) {
    await addLayersFromGeometry(existingGeometry);
  }

  // Restore the last tool the user picked. If none yet, leave Terra Draw in its
  // default "static" mode so no tool is selected.
  const restoredMode = getLastDrawMode();
  if (restoredMode) setDrawMode(restoredMode);
}

/**
 * Switch the active drawing tool and remember it for the next editor session.
 * No-op on the Terra Draw instance if the editor is not active.
 */
export function setDrawMode(mode: ShapeDrawMode): void {
  lastDrawMode = mode;
  if (!draw) return;
  draw.setMode(mode);
}

/**
 * Remove the currently selected shape entirely. Unlike deleting a node, this works
 * regardless of how few coordinates the shape has, so it is the way to delete a
 * triangle, a two-point line, or any whole shape.
 */
export function deleteSelectedShape(): void {
  if (!draw || selectedShapeId.value === null) return;
  draw.removeFeatures([selectedShapeId.value]);
  selectedShapeId.value = null;
}

/**
 * Remove all drawn layers and tear down the editor.
 */
export async function destroyShapeEditor(): Promise<void> {
  if (!draw) return;
  selectedShapeId.value = null;
  map.value.getCanvasContainer().removeEventListener("contextmenu", handleDrawingRightClick);
  draw.clear();
  draw.stop();
  draw = null;
  // Terra Draw sets the canvas cursor to crosshair while drawing and does not
  // restore it on stop, so reset it here.
  const canvas = map.value.getCanvas();
  // oxlint-disable-next-line no-unnecessary-condition
  if (canvas) canvas.style.cursor = "";
}

/**
 * Extract all drawn shapes as a GeoJSON GeometryCollection.
 * Includes both shapes drawn in this session AND shapes loaded from existing geometry,
 * so that saving always produces the full set of shapes (not just newly added ones).
 * Internal vertex/snapping points (rendered as Point features) are filtered out by type.
 */
export function getDrawnGeometry(): GeoJSON.GeometryCollection {
  if (!draw) return { type: "GeometryCollection", geometries: [] };

  const geometries = draw
    .getSnapshot()
    .map((f) => f.geometry as GeoJSON.Geometry)
    .filter((geometry) => drawableGeometryTypes.has(geometry.type));

  return { type: "GeometryCollection", geometries };
}

/**
 * Convert a single GeoJSON geometry into Terra Draw features. Terra Draw modes
 * only accept single LineString/Polygon geometries, so Multi* are split into parts.
 * Each feature is tagged with the `mode` property Terra Draw uses for routing.
 */
function geometryToFeatures(geometry: GeoJSON.Geometry): GeoJSONStoreFeatures[] {
  function makeFeature(geom: GeoJSON.Geometry, mode: ShapeDrawMode): GeoJSONStoreFeatures {
    // oxlint-disable-next-line no-unsafe-type-assertion
    return {
      type: "Feature",
      // oxlint-disable-next-line no-non-null-assertion
      id: draw!.getFeatureId(),
      geometry: geom,
      properties: { mode },
    } as unknown as GeoJSONStoreFeatures;
  }

  switch (geometry.type) {
    case "LineString":
      return [makeFeature(geometry, "linestring")];
    case "MultiLineString":
      return geometry.coordinates.map((coords) =>
        makeFeature({ type: "LineString", coordinates: coords }, "linestring"),
      );
    case "Polygon":
      return [makeFeature(geometry, "polygon")];
    case "MultiPolygon":
      return geometry.coordinates.map((coords) =>
        makeFeature({ type: "Polygon", coordinates: coords }, "polygon"),
      );
    default:
      return [];
  }
}

/**
 * Add shapes from an existing GeometryCollection onto the map so the user can edit them.
 */
export async function addLayersFromGeometry(
  geometry: GeoJSON.GeometryCollection,
): Promise<LngLatBounds | null> {
  if (!draw) return null;

  const drawableGeoms = geometry.geometries.filter((item) => drawableGeometryTypes.has(item.type));
  if (drawableGeoms.length === 0) return null;

  let bounds: LngLatBounds | null = null;

  // Process in batches to yield between each, keeping the browser responsive.
  for (let i = 0; i < drawableGeoms.length; i += 1) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // oxlint-disable-next-line no-non-null-assertion
    const geom = drawableGeoms[i]!;

    draw.addFeatures(geometryToFeatures(geom));

    forEachPosition(geom, (lng, lat) => {
      if (bounds) bounds.extend([lng, lat]);
      else bounds = new LngLatBounds([lng, lat], [lng, lat]);
    });
  }

  return bounds;
}

/**
 * Read a .geojson / .json file and return drawable shapes plus any skipped geometry types.
 * Handles FeatureCollection, GeometryCollection, Feature, and raw geometry inputs.
 * Throws a descriptive Error if the file is not valid JSON or not a recognised GeoJSON type.
 */
export async function loadGeoJSONFile(file: File): Promise<LoadedGeoJSON> {
  const text = await file.text();
  const parsed = (() => {
    try {
      // oxlint-disable-next-line no-unsafe-type-assertion
      return JSON.parse(text) as GeoJSON.GeoJSON;
    } catch {
      throw new Error(`Invalid JSON in file "${file.name}"`);
    }
  })();

  if (parsed.type === "FeatureCollection") {
    const geometries = parsed.features.map((f) => f.geometry);
    const featureProperties = parsed.features.map(
      (f) => (f.properties ?? {}) as Record<string, unknown>,
    );
    return filterDrawableGeometries(geometries, featureProperties);
  }

  if (parsed.type === "GeometryCollection") {
    return filterDrawableGeometries(parsed.geometries);
  }

  // Single geometry or Feature
  if (parsed.type === "Feature") {
    const featureProperties = parsed.properties
      ? [parsed.properties as Record<string, unknown>]
      : [];
    return filterDrawableGeometries([parsed.geometry], featureProperties);
  }

  if ("coordinates" in parsed) {
    return filterDrawableGeometries([parsed]);
  }

  throw new Error(
    `Unrecognised GeoJSON type "${(parsed as { type: string }).type}" in file "${file.name}"`,
  );
}
