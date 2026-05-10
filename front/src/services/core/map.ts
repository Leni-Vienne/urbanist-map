import L from "leaflet";
import { debounce } from "@/utils/debounce";
import { ref, customRef } from "vue";

// Parse #map=zoom/lat/lng from the URL hash
function parseHashCoords(): { lat: number; lng: number; zoom: number } | null {
  const hash = globalThis.location.hash;
  if (!hash) return null;
  const match = /^#map=([0-9.]+)\/([-0-9.]+)\/([-0-9.]+)$/.exec(hash);
  if (!match) return null;
  const zoom = Number(match[1]);
  const lat = Number(match[2]);
  const lng = Number(match[3]);
  if (Number.isNaN(zoom) || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;
  return { lat, lng, zoom };
}

// Update the URL hash with current map view
function updateHash() {
  if (!_map) return;
  const center = _map.getCenter();
  const zoom = _map.getZoom();
  const hash = `#map=${zoom.toFixed(2)}/${center.lat.toFixed(4)}/${center.lng.toFixed(4)}`;
  history.replaceState(null, "", hash);
}

let _map: L.Map | null = null;
export const map = customRef<L.Map>((track, trigger) => ({
  get() {
    track();
    if (_map === null) {
      // Typed as L.Map but returns null when uninitialized.
      // Callers guard with `if (map.value)` at runtime; TypeScript sees no null.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return null as unknown as L.Map;
    }
    return _map;
  },
  set(newValue) {
    _map = newValue; // Stored as a raw (non-reactive) object, required by Leaflet.
    trigger();
  },
}));
export const currentZoomLevel = ref(13);

const debouncedInvalidateSize = debounce(() => {
  map.value.invalidateSize();
}, 250);

// Minimum zoom scales with display resolution to avoid black borders at the map edges.
// 4K+ (>= 2560px): zoom 3, HD and below (<= 1920px): zoom 2, linearly interpolated between.
function calculateMinZoom(): number {
  const largerDimension = Math.max(globalThis.innerWidth, globalThis.innerHeight);
  if (largerDimension >= 2560) return 3;
  if (largerDimension <= 1920) return 2;
  return 2 + (largerDimension - 1920) / (2560 - 1920);
}

export function initializeMap() {
  const hashCoords = parseHashCoords();
  const minZoom = calculateMinZoom();
  map.value = L.map("mapDiv", {
    center: hashCoords ? [hashCoords.lat, hashCoords.lng] : [22, 10],
    zoom: hashCoords ? Math.max(hashCoords.zoom, minZoom) : minZoom,
    minZoom,
    maxZoom: 22,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    worldCopyJump: true, // keeps markers in sync when crossing the antimeridian
    zoomControl: false, // custom zoom control used instead
    maxBounds: L.latLngBounds([-85, Infinity], [85, -Infinity]), // prevent vertical black borders
    maxBoundsViscosity: 1, // bounce back when panning past the poles
    touchZoom: true, // prevents the browser zoom from firing instead of the map zoom on mobile
    keyboard: false,
    fadeAnimation: true,
    markerZoomAnimation: true,
  });
  map.value.attributionControl.setPrefix(false);

  currentZoomLevel.value = map.value.getZoom();
  map.value.on("zoomend", () => {
    currentZoomLevel.value = map.value.getZoom();
  });

  // Sync map position to URL hash for shareable links
  map.value.on("moveend", updateHash);
  updateHash();

  globalThis.addEventListener("resize", debouncedInvalidateSize);
}

export function disableLeafletKeyboardEvents() {
  const mapContainer = map.value.getContainer();

  // Stops Leaflet from intercepting keystrokes typed into overlaid UI panels.
  // Trade-off: arrow-key map panning is also disabled.
  for (const eventType of ["keydown", "keyup", "keypress"]) {
    mapContainer.addEventListener(
      eventType,
      (e: Event) => {
        e.stopPropagation();
      },
      true,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
