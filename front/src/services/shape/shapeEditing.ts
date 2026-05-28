// Lazy chunk, only imported when a user activates the shape editor in edit mode.
// Same pattern as overlayRendering.ts.
import { createGeomanInstance, Geoman } from "@geoman-io/maplibre-geoman-free";
// @ts-expect-error Cannot find module or type declarations for side-effect import
import "@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css";
import { map } from "@/services/core/map";
import { LngLatBounds } from "maplibre-gl";
import { forEachPosition } from "@/utils/geojson";

const drawableGeometryTypes = new Set(["LineString", "MultiLineString", "Polygon", "MultiPolygon"]);

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

let gm: Geoman | null = null;

/**
 * Activate the Geoman toolbar on the map with relevant draw tools only.
 * If existingGeometry is provided, the layers are added to the map.
 */
export async function initShapeEditor(
  existingGeometry?: GeoJSON.GeometryCollection,
): Promise<void> {
  const mlMap = map.value;
  if (!mlMap) return;

  if (!gm) {
    gm = await createGeomanInstance(mlMap, {
      settings: {
        useControlsUi: true,
      },
      controls: {
        draw: {
          line: { uiEnabled: true },
          polygon: { uiEnabled: true },
          rectangle: { uiEnabled: false },
          circle: { uiEnabled: false },
          circle_marker: { uiEnabled: false },
          ellipse: { uiEnabled: false },
          marker: { uiEnabled: false },
          text_marker: { uiEnabled: false },
          freehand: { uiEnabled: false },
          custom_shape: { uiEnabled: false },
        },
        edit: {
          drag: { uiEnabled: true },
          change: { uiEnabled: true },
          delete: { uiEnabled: true },
          rotate: { uiEnabled: false },
          scale: { uiEnabled: false },
          cut: { uiEnabled: false },
          split: { uiEnabled: false },
          copy: { uiEnabled: false },
          union: { uiEnabled: false },
          difference: { uiEnabled: false },
          line_simplification: { uiEnabled: false },
          lasso: { uiEnabled: false },
        },
        helper: {
          shape_markers: { uiEnabled: true },
          pin: { uiEnabled: false },
          snapping: { uiEnabled: true },
          snap_guides: { uiEnabled: true },
          measurements: { uiEnabled: false },
          auto_trace: { uiEnabled: false },
          geofencing: { uiEnabled: false },
          zoom_to_features: { uiEnabled: false },
          click_to_edit: { uiEnabled: false },
        },
      },
    });
  }

  // Double-init guard: clear existing features before re-initializing
  if (gm.features) {
    await gm.features.deleteAll();
  }

  await gm.addControls();

  if (existingGeometry) {
    await addLayersFromGeometry(existingGeometry);
  }

  // Pre-select the Line tool by default when the shape editor opens
  await gm.enableDraw("line");
}

/**
 * Remove all geoman-drawn layers and the controls toolbar.
 */
export async function destroyShapeEditor(): Promise<void> {
  if (!gm) return;
  await gm.disableAllModes();
  if (gm.features) {
    await gm.features.deleteAll();
  }
  await gm.removeControls();
}

/**
 * Extract all geoman-drawn layers as a GeoJSON GeometryCollection.
 * Includes both layers drawn in this session AND layers loaded from existing geometry,
 * so that saving always produces the full set of shapes (not just newly added ones).
 */
export function getDrawnGeometry(): GeoJSON.GeometryCollection {
  if (!gm || !gm.features) return { type: "GeometryCollection", geometries: [] };

  const fc = gm.features.exportGeoJson();

  const geometries = fc.features
    .map((f) => f.geometry)
    .filter((geometry) => drawableGeometryTypes.has(geometry.type));

  return { type: "GeometryCollection", geometries };
}

/**
 * Add layers from an existing GeometryCollection onto the map so the user can edit them.
 */
export async function addLayersFromGeometry(
  geometry: GeoJSON.GeometryCollection,
): Promise<LngLatBounds | null> {
  if (!gm || !gm.features) return null;

  const drawableGeoms = geometry.geometries.filter((item) => drawableGeometryTypes.has(item.type));
  if (drawableGeoms.length === 0) return null;

  let bounds: LngLatBounds | null = null;

  // Process in batches to yield between each, keeping the browser responsive.
  for (let i = 0; i < drawableGeoms.length; i += 1) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const geom = drawableGeoms[i]!;

    const feature: GeoJSON.Feature = { type: "Feature", geometry: geom, properties: {} };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await gm.features.importGeoJsonFeature(feature as any);

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
