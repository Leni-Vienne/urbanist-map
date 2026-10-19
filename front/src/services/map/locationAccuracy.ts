import { LngLatBounds, type GeoJSONSource } from "maplibre-gl";
import { getMapOrNull, onMapReady, onStyleSwitch } from "@/services/core/map";
import { projectDataLayersBottomId } from "@/services/map/layerOrder";
import { locationAccuracyRing } from "@/services/map/locationAccuracyGeometry";

const SOURCE_ID = "user-location-accuracy";
const FILL_ID = "user-location-accuracy-fill";
const OUTLINE_ID = "user-location-accuracy-outline";

/** Own the accuracy overlay for one location control, including basemap changes. */
export function createLocationAccuracyOverlay() {
  let ring: [number, number][] | null = null;

  function sync(): void {
    const map = getMapOrNull();
    // The project source marks the point where the initial style and application layers are ready.
    if (!ring || !map?.getSource("project-sources")) return;
    const data = { type: "Polygon" as const, coordinates: [ring] };
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    if (source) {
      void source.setData(data);
      return;
    }

    map.addSource(SOURCE_ID, { type: "geojson", data });
    const before = projectDataLayersBottomId(map.getStyle().layers);
    map.addLayer(
      {
        id: FILL_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.12 },
      },
      before,
    );
    map.addLayer(
      {
        id: OUTLINE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": "#3b82f6", "line-opacity": 0.6, "line-width": 1.5 },
      },
      before,
    );
  }

  function show(longitude: number, latitude: number, radiusMeters: number): LngLatBounds {
    ring = locationAccuracyRing(longitude, latitude, radiusMeters);
    sync();
    const bounds = new LngLatBounds();
    for (const point of ring) bounds.extend(point);
    return bounds;
  }

  function clear(): void {
    ring = null;
    const map = getMapOrNull();
    if (!map) return;
    for (const id of [OUTLINE_ID, FILL_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  const stopReady = onMapReady(sync);
  const stopStyleSwitch = onStyleSwitch((phase) => {
    if (phase === "after") sync();
  });

  function dispose(): void {
    stopReady();
    stopStyleSwitch();
    clear();
  }

  return { show, clear, dispose };
}
