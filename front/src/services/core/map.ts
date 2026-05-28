import maplibre, { type Map as MaplibreMap, type RequestParameters } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ref, customRef } from "vue";
import { getApiUrl } from "@/client";

export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// The URL hash stores a Leaflet-equivalent zoom (MapLibre zoom + 1) so links shared
// before the MapLibre migration keep rendering the same view. Internally we use native
// MapLibre zoom everywhere else.
const HASH_ZOOM_OFFSET = 1;

// Parse #map=zoom/lat/lng from the URL hash. Returns native MapLibre zoom.
function parseHashCoords(): { lat: number; lng: number; zoom: number } | null {
  const hash = globalThis.location.hash;
  if (!hash) return null;
  const match = /^#map=([0-9.]+)\/([-0-9.]+)\/([-0-9.]+)$/.exec(hash);
  if (!match) return null;
  const hashZoom = Number(match[1]);
  const lat = Number(match[2]);
  const lng = Number(match[3]);
  if (Number.isNaN(hashZoom) || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;
  return { lat, lng, zoom: hashZoom - HASH_ZOOM_OFFSET };
}

// Update the URL hash with current map view, written as Leaflet-equivalent zoom.
function updateHash() {
  if (!_map) return;
  const center = _map.getCenter();
  const zoom = _map.getZoom() + HASH_ZOOM_OFFSET;
  const hash = `#map=${zoom.toFixed(2)}/${center.lat.toFixed(4)}/${center.lng.toFixed(4)}`;
  history.replaceState(null, "", hash);
}

let _map: MaplibreMap | null = null;
export const map = customRef<MaplibreMap>((track, trigger) => ({
  get() {
    track();
    if (_map === null) {
      // Typed as MaplibreMap but returns null when uninitialized.
      // Callers guard with `if (map.value)` at runtime; TypeScript sees no null.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return null as unknown as MaplibreMap;
    }
    return _map;
  },
  set(newValue) {
    _map = newValue; // Stored as a raw (non-reactive) object, required by MapLibre.
    trigger();
  },
}));
export const currentZoomLevel = ref(12);

// Minimum zoom scales with display resolution to avoid black borders at the map edges.
// 4K+ (>= 2560px): zoom 2, HD and below (<= 1920px): zoom 1, linearly interpolated between.
function calculateMinZoom(): number {
  const largerDimension = Math.max(globalThis.innerWidth, globalThis.innerHeight);
  if (largerDimension >= 2560) return 2;
  if (largerDimension <= 1920) return 1;
  return 1 + (largerDimension - 1920) / (2560 - 1920);
}

// Pending overlay images live behind the authenticated /uploads/ endpoint; MapLibre image
// sources must send credentials to fetch them. Scoped strictly to that backend path so the
// public basemap style/tiles (wildcard CORS) and R2 CDN images are never sent credentials.
function transformMapRequest(url: string): RequestParameters | undefined {
  if (url.startsWith(`${getApiUrl()}/uploads/`)) {
    return { url, credentials: "include" };
  }
  return undefined;
}

export function initializeMap() {
  const hashCoords = parseHashCoords();
  const minZoom = calculateMinZoom();

  const newMap = new maplibre.Map({
    container: "mapDiv",
    style: OPENFREEMAP_STYLE_URL,
    center: hashCoords ? [hashCoords.lng, hashCoords.lat] : [10, 22],
    zoom: hashCoords ? Math.max(hashCoords.zoom, minZoom) : minZoom,
    minZoom,
    maxZoom: 21,
    attributionControl: false, // custom attribution control added below
    transformRequest: transformMapRequest,
    // North-up, top-down only. Rotation and pitch are deliberately disabled (Phase 1 decision).
    dragRotate: false,
    pitchWithRotate: false,
    rollEnabled: false,
    touchPitch: false,
    maxPitch: 0,
    fadeDuration: 0,
  });
  map.value = newMap;

  newMap.touchZoomRotate.disableRotation();
  // Match the previous Leaflet behavior: the map does not capture keystrokes, so typing
  // into overlaid UI panels never pans/zooms the map. Trade-off: no keyboard map control.
  newMap.keyboard.disable();

  // Attribution is collected automatically from each active style's source `attribution`
  // fields, so it switches correctly between the plan basemap and satellite layers.
  newMap.addControl(new maplibre.AttributionControl({ compact: false }));

  currentZoomLevel.value = newMap.getZoom();
  newMap.on("zoomend", () => {
    currentZoomLevel.value = newMap.getZoom();
  });

  // Sync map position to URL hash for shareable links
  newMap.on("moveend", updateHash);
  updateHash();
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
