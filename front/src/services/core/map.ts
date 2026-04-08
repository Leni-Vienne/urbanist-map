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
      // User requested strict typing without null checks.
      // Returning null here allows `if (map.value)` to work safely (falsy),
      // but TypeScript will think it's always L.Map.
      // This is a "safe lie". Runtime checks work, Compile checks are silenced.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return null as unknown as L.Map;
    }
    return _map;
  },
  set(newValue) {
    _map = newValue; // Stored as raw object (shallow), not reactive. Perfect for Leaflet.
    trigger();
  },
}));
// Reactive zoom level tracking
export const currentZoomLevel = ref(13);

// Create a debounced version of invalidateSize to handle window resizing
const debouncedInvalidateSize = debounce(() => {
  // Trigger a resize event on the map to ensure all components adjust
  map.value.invalidateSize();
}, 250);

// Calculate minimum zoom based on viewport to avoid black borders
// Higher resolution displays need higher minimum zoom to fill the viewport
function calculateMinZoom(): number {
  const viewportWidth = globalThis.innerWidth;
  const viewportHeight = globalThis.innerHeight;
  const largerDimension = Math.max(viewportWidth, viewportHeight);

  // For displays wider/taller than 2560px (typical 4K), use zoom level 3
  // For standard HD (1920px and below), use zoom level 2
  // Linear interpolation between these thresholds
  if (largerDimension >= 2560) {
    return 3;
  } else if (largerDimension <= 1920) {
    return 2;
  } else {
    // Interpolate between 2 and 3 for resolutions between 1920 and 2560
    return 2 + (largerDimension - 1920) / (2560 - 1920);
  }
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
    worldCopyJump: true, // to keep markers in sync when crossing the antimeridian
    zoomControl: false, // Because we have our own zoom control
    maxBounds: L.latLngBounds([-85, Infinity], [85, -Infinity]), // Constrain vertical panning to prevent black borders
    maxBoundsViscosity: 1, // Gently bounce back when panning all the way up/down
    touchZoom: true, // True otherwise the website is zoomed instead of the map on mobile,
    keyboard: false,
    fadeAnimation: true,
    markerZoomAnimation: true,
  });
  // Remove the default "Leaflet" prefix from the attribution control
  map.value.attributionControl.setPrefix(false);

  // Initialize reactive zoom level with Leaflet's default
  currentZoomLevel.value = map.value.getZoom();

  // Listen for zoom changes to update reactive zoom level
  map.value.on("zoomend", () => {
    currentZoomLevel.value = map.value.getZoom();
  });

  // Sync map view coordinates to URL hash for easy sharing
  map.value.on("moveend", updateHash);
  updateHash(); // Set initial hash

  // Save map dimensions

  // Update map size when window is resized (debounced to trigger only on resize end)
  globalThis.addEventListener("resize", debouncedInvalidateSize);

  // Ensure the map initialization is complete
}

export function disableLeafletKeyboardEvents() {
  const mapContainer = map.value.getContainer();

  // To prevent keystrokes from InfoPopup to be intercepted by Leaflet
  // Unfortunately, it prevnts the user of the arrow keys to move the map (but there is prob a way around it)
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
