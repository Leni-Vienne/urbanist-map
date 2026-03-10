// Lazy chunk — only imported when a user activates the shape editor in edit mode.
// Same pattern as overlayRendering.ts.
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

// Track layers added from existing geometry (not tracked by Geoman as "drawn" layers).
let geometryLayers: L.Layer[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pmCreateHandler: ((e: any) => void) | null = null;

/**
 * Activate the Geoman toolbar on the map with relevant draw tools only.
 * If existingGeometry is provided, the layers are added to the map.
 */
export function initShapeEditor(
  mapInstance: L.Map,
  existingGeometry?: GeoJSON.GeometryCollection,
): void {
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

  // Enable edit mode on newly drawn layers so nodes are draggable immediately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pmCreateHandler = ({ layer }: { layer: any }) => {
    layer.pm?.enable?.();
  };
  mapInstance.on("pm:create", pmCreateHandler);

  if (existingGeometry) {
    addLayersFromGeometry(mapInstance, existingGeometry);
  }
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
  // Combine geoman-tracked draw layers with layers loaded from existing geometry.
  // Geoman's getGeomanDrawLayers() only returns layers it created itself — layers added
  // via addLayersFromGeometry (existing shapes) are tracked separately in geometryLayers.
  const allLayers = [...mapInstance.pm.getGeomanDrawLayers(), ...geometryLayers];

  const geometries = allLayers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((layer) => (layer as any).toGeoJSON?.() as GeoJSON.Feature | undefined)
    .filter(
      (f): f is GeoJSON.Feature => f !== undefined && f.type === "Feature" && f.geometry !== null,
    )
    .map((f) => f.geometry);

  return { type: "GeometryCollection", geometries };
}

/**
 * Add layers from an existing GeometryCollection onto the map so the user can edit them.
 */
export function addLayersFromGeometry(
  mapInstance: L.Map,
  geometry: GeoJSON.GeometryCollection,
): void {
  // Process each geometry individually by wrapping it in a Feature.
  // Using L.geoJSON(geometryCollection) produces a single FeatureGroup (not individual layers),
  // whose toGeoJSON() returns a FeatureCollection that fails the Feature type check in getDrawnGeometry.
  // Wrapping each geometry separately guarantees one Leaflet layer per geometry,
  // each with a toGeoJSON() that returns a proper Feature.
  for (const geom of geometry.geometries) {
    const feature: GeoJSON.Feature = { type: "Feature", geometry: geom, properties: {} };
    const layer = L.geoJSON(feature).getLayers()[0];
    if (!layer) continue;
    layer.addTo(mapInstance);
    geometryLayers.push(layer);
    // Reinitialize Geoman on this externally-created layer so vertex handles appear.
    // Layers created via L.geoJSON() are not tracked by Geoman's draw pipeline,
    // so reInitLayer re-applies the PM mixin before enabling edit mode.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (L as any).PM?.reInitLayer?.(layer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (layer as any).pm?.enable?.();
  }
}

/**
 * Read a .geojson / .json file and return a GeometryCollection.
 * Handles both FeatureCollection and GeometryCollection inputs.
 */
export async function loadGeoJSONFile(file: File): Promise<GeoJSON.GeometryCollection> {
  const text = await file.text();
  const parsed = JSON.parse(text) as GeoJSON.GeoJSON;

  if (parsed.type === "FeatureCollection") {
    const geometries = parsed.features
      .map((f) => f.geometry)
      .filter((g): g is GeoJSON.Geometry => g !== null);
    return { type: "GeometryCollection", geometries };
  }

  if (parsed.type === "GeometryCollection") {
    return parsed;
  }

  // Single geometry or Feature
  if (parsed.type === "Feature" && parsed.geometry) {
    return { type: "GeometryCollection", geometries: [parsed.geometry] };
  }

  // Treat as a raw geometry
  return { type: "GeometryCollection", geometries: [parsed as GeoJSON.Geometry] };
}
