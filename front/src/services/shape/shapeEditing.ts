// Lazy chunk — only imported when a user activates the shape editor in edit mode.
// Same pattern as overlayRendering.ts.
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

const drawableGeometryTypes = new Set(["LineString", "MultiLineString", "Polygon", "MultiPolygon"]);
const supportedImportGeometryTypes = new Set([...drawableGeometryTypes, "Point", "MultiPoint"]);

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

// Track layers added from existing geometry (not tracked by Geoman as "drawn" layers).
let geometryLayers: L.Layer[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pmCreateHandler: ((e: any) => void) | null = null;

/**
 * Activate the Geoman toolbar on the map with relevant draw tools only.
 * If existingGeometry is provided, the layers are added to the map.
 */
export async function initShapeEditor(
  mapInstance: L.Map,
  existingGeometry?: GeoJSON.GeometryCollection,
): Promise<void> {
  // Geoman uses addInitHook, so map instances created before this lazy chunk was loaded
  // won't have .pm set. Manually initialize it on the existing instance.
  if (!mapInstance.pm) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mapInstance as any).pm = new (L as any).PM.Map(mapInstance);
  }

  mapInstance.pm.addControls({
    drawRectangle: false,
    drawMarker: false,
    drawCircle: false,
    drawCircleMarker: false,
    drawText: false,
    cutPolygon: false,
    rotateMode: false,
    removalMode: false,
    editControls: false,
  });

  // Double-init guard: remove geometry layers from any previous init.
  for (const layer of geometryLayers) layer.remove();
  geometryLayers = [];

  // Enable edit mode on newly drawn layers immediately; swap handler to avoid accumulating listeners.
  if (pmCreateHandler) {
    mapInstance.off("pm:create", pmCreateHandler);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pmCreateHandler = ({ layer }: { layer: any }) => {
    layer.pm?.enable?.();
  };
  mapInstance.on("pm:create", pmCreateHandler);

  if (existingGeometry) {
    await addLayersFromGeometry(mapInstance, existingGeometry, { editable: true });
  }

  // Pre-select the Line tool by default when the shape editor opens
  mapInstance.pm.enableDraw("Line");
}

/**
 * Remove all geoman-drawn layers and the controls toolbar.
 */
export function destroyShapeEditor(mapInstance: L.Map): void {
  if (pmCreateHandler) {
    mapInstance.off("pm:create", pmCreateHandler);
    pmCreateHandler = null;
  }
  // Disable any active global modes before removing controls — otherwise layers that
  // were touched by Geoman's toolbar (e.g. rendered project shapes) stay editable.
  mapInstance.pm.disableDraw();
  if (mapInstance.pm.globalEditModeEnabled()) mapInstance.pm.disableGlobalEditMode();
  if (mapInstance.pm.globalDragModeEnabled()) mapInstance.pm.disableGlobalDragMode();
  for (const layer of mapInstance.pm.getGeomanDrawLayers()) layer.remove();
  // Also remove layers loaded from existing geometry — Geoman doesn't track these.
  for (const layer of geometryLayers) layer.remove();
  geometryLayers = [];
  mapInstance.pm.removeControls();
}

/**
 * Extract all geoman-drawn layers as a GeoJSON GeometryCollection.
 * Includes both layers drawn in this session AND layers loaded from existing geometry,
 * so that saving always produces the full set of shapes (not just newly added ones).
 */
export function getDrawnGeometry(mapInstance: L.Map): GeoJSON.GeometryCollection {
  const allLayers = [...mapInstance.pm.getGeomanDrawLayers(), ...geometryLayers];

  const geometries = allLayers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((layer) => (layer as L.Polyline | L.Polygon).toGeoJSON() as GeoJSON.Feature | undefined)
    .filter((f): f is GeoJSON.Feature => f?.type === "Feature" && f.geometry !== null)
    .map((f) => f.geometry)
    .filter((geometry) => drawableGeometryTypes.has(geometry.type));

  return { type: "GeometryCollection", geometries };
}

/**
 * Add layers from an existing GeometryCollection onto the map so the user can edit them.
 */
export async function addLayersFromGeometry(
  mapInstance: L.Map,
  geometry: GeoJSON.GeometryCollection,
  { editable = false }: { editable?: boolean } = {},
): Promise<L.LatLngBounds | null> {
  const addedLayers: L.Layer[] = [];

  const drawableGeoms = geometry.geometries.filter((item) => drawableGeometryTypes.has(item.type));

  // Process in batches, yielding between each so the browser can repaint and stay responsive.
  // Without this, adding hundreds of Leaflet layers synchronously freezes the main thread.
  for (let i = 0; i < drawableGeoms.length; i++) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const geom = drawableGeoms[i]!;

    // Process each geometry individually by wrapping it in a Feature.
    // Using L.geoJSON(geometryCollection) produces a single FeatureGroup (not individual layers),
    // whose toGeoJSON() returns a FeatureCollection that fails the Feature type check in getDrawnGeometry.
    // Wrapping each geometry separately guarantees one Leaflet layer per geometry,
    // each with a toGeoJSON() that returns a proper Feature.
    const feature: GeoJSON.Feature = { type: "Feature", geometry: geom, properties: {} };
    const layer = L.geoJSON(feature).getLayers()[0];
    if (!layer) continue;
    layer.addTo(mapInstance);
    addedLayers.push(layer);
    geometryLayers.push(layer);
    if (editable) {
      // Reinitialize Geoman on this externally-created layer so vertex handles appear.
      // Layers created via L.geoJSON() are not tracked by Geoman's draw pipeline,
      // so reInitLayer re-applies the PM mixin before enabling edit mode.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (L as any).PM?.reInitLayer?.(layer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (layer as any).pm?.enable?.();
    }
  }

  if (addedLayers.length === 0) return null;

  const groupBounds = L.featureGroup(addedLayers).getBounds();
  return groupBounds.isValid() ? groupBounds : null;
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
