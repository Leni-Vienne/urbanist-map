// Lazy chunk — only imported when a user activates the shape editor in edit mode.
// Same pattern as overlayRendering.ts.
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

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
    drawMarker: false,
    drawCircle: false,
    drawCircleMarker: false,
    drawText: false,
    cutPolygon: false,
    rotateMode: false,
  });

  if (existingGeometry) {
    addLayersFromGeometry(mapInstance, existingGeometry);
  }
}

/**
 * Remove all geoman-drawn layers and the controls toolbar.
 */
export function destroyShapeEditor(mapInstance: L.Map): void {
  mapInstance.pm.getGeomanDrawLayers().forEach((layer) => layer.remove());
  mapInstance.pm.removeControls();
}

/**
 * Extract all geoman-drawn layers as a GeoJSON GeometryCollection.
 */
export function getDrawnGeometry(mapInstance: L.Map): GeoJSON.GeometryCollection {
  const geometries = mapInstance.pm
    .getGeomanDrawLayers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((layer) => (layer as any).toGeoJSON?.() as GeoJSON.Feature | undefined)
    .filter((f): f is GeoJSON.Feature => !!f && f.type === "Feature" && f.geometry !== null)
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
  L.geoJSON(geometry).eachLayer((layer) => {
    layer.addTo(mapInstance);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (layer as any).pm?.enable?.();
  });
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
