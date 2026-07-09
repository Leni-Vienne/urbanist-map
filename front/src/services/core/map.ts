import maplibre, { type Map as MaplibreMap, type RequestParameters } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"; // needed for maplibre controls and attribution styling
import { ref, watch, shallowRef } from "vue";
import { getApiUrl } from "@/client";
import { mapRotationEnabled } from "@/services/map/settings";

export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Read the project location the SEO Pages Function injected into the shell for a /project/:slug
// deep link (`<meta name="deeplink-view" content="lat,lng">`). Present only in production, where the
// Function runs; absent on the vite dev server. Lets the map be constructed already centered on the
// project so its first paint shows the right place instead of animating in from the default view.
function parseDeeplinkView(): { lat: number; lng: number } | null {
  const content = document.querySelector('meta[name="deeplink-view"]')?.getAttribute("content");
  if (!content) return null;
  const [latStr, lngStr] = content.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseDeeplinkBounds(): [number, number, number, number] | null {
  const content = document.querySelector('meta[name="deeplink-bounds"]')?.getAttribute("content");
  if (!content) return null;
  const parts = content.split(",").map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    // oxlint-disable-next-line no-non-null-assertion
    return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
  }
  return null;
}

// True when the map was constructed centered on a deep-link project (see parseDeeplinkView). The
// deep-link handler reads this to set the camera instantly instead of flying, since the map already
// booted at the target.
export const bootedFromDeeplinkView = ref(false);

// Exported as non-null MaplibreMap to satisfy TypeScript, though it is technically null before map initialization.
// This allows callers to safely use map.value without strict null checking boilerplate.
// eslint-disable-next-line no-unsafe-type-assertion
export const map = shallowRef<MaplibreMap>(null as unknown as MaplibreMap);
export const currentZoomLevel = ref(12);
export const currentBearing = ref(0);
export const currentPitch = ref(0);

// True once the basemap style has loaded and project data + interaction are wired up.
// Preserved across Vite HMR so onMlMapReady callers don't wait for a `load` event that
// already fired on the still-alive map instance.
// oxlint-disable-next-line no-unnecessary-condition fails in preview/prod without the condition
let styleReady = import.meta.hot?.data?.styleReady ?? false;
const mlMapReadyCallbacks: (() => void)[] = [];

/** Register a callback to run once (immediately if already ready) when the map is loaded. */
export function onMlMapReady(cb: () => void): void {
  if (styleReady) {
    cb();
  } else {
    mlMapReadyCallbacks.push(cb);
  }
}

/** Mark the style ready and flush queued onMlMapReady callbacks. Called once on first style load. */
export function markMlMapReady(): void {
  styleReady = true;
  for (const cb of mlMapReadyCallbacks) cb();
  mlMapReadyCallbacks.length = 0;
}

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

// MapLibre's ScrollZoomHandler fixes the zoom focal point to the cursor position at the
// moment a continuous scroll gesture starts, then keeps zooming toward it for the whole
// gesture. Moving the cursor mid-scroll therefore keeps zooming toward the stale point.
// Refresh the focal point on every wheel event so zoom always tracks the current cursor.
// This reaches into the handler's private `_aroundPoint`, as there is no public API for it.
function enableCursorTrackingScrollZoom(targetMap: MaplibreMap): void {
  /* eslint-disable no-underscore-dangle -- mirrors MapLibre's private fields */
  // eslint-disable-next-line no-unsafe-type-assertion
  const handler = targetMap.scrollZoom as unknown as {
    wheel: (e: WheelEvent) => void;
    _aroundPoint?: { x: number; y: number };
    _aroundCenter?: boolean;
    cursorTrackingPatched?: boolean;
  };
  if (handler.cursorTrackingPatched) return;
  handler.cursorTrackingPatched = true;

  const canvas = targetMap.getCanvas();
  const originalWheel = handler.wheel.bind(handler);
  handler.wheel = function wheel(e: WheelEvent): void {
    originalWheel(e);
    // _aroundCenter means zoom-to-center is requested, so the cursor is irrelevant.
    if (handler._aroundCenter || !handler._aroundPoint) return;
    // Matches DOM.mousePos for an unscaled canvas (the basemap canvas has no CSS transform).
    const rect = canvas.getBoundingClientRect();
    handler._aroundPoint.x = e.clientX - rect.left - canvas.clientLeft;
    handler._aroundPoint.y = e.clientY - rect.top - canvas.clientTop;
  };
  /* eslint-enable no-underscore-dangle */
}

export function initializeMap() {
  const hasMapHash = globalThis.location.hash.startsWith("#map=");
  // An explicit map-state hash wins over the deep-link view (e.g. a shared link with both).
  const deeplinkBounds = hasMapHash ? null : parseDeeplinkBounds();
  const deeplinkView = hasMapHash || deeplinkBounds ? null : parseDeeplinkView();
  bootedFromDeeplinkView.value = deeplinkView !== null || deeplinkBounds !== null;
  const minZoom = calculateMinZoom();

  // Default world view, overridden by the hash (shared link) or the deep-link view (SEO shell). The
  // deep-link handler refines the zoom to a geometry fit the instant the map is ready; 14 is a
  // sensible first-paint zoom matching the marker-style default for the common standalone case.
  let initialCenter: [number, number] = [10, 22];
  let initialZoom = minZoom;
  if (deeplinkView) {
    initialCenter = [deeplinkView.lng, deeplinkView.lat];
    initialZoom = Math.max(14, minZoom);
  }

  const mapOptions: maplibre.MapOptions = {
    container: "mapDiv",
    style: OPENFREEMAP_STYLE_URL,
    hash: "map",
    center: initialCenter,
    zoom: initialZoom,
    ...(deeplinkBounds
      ? { bounds: deeplinkBounds, fitBoundsOptions: { padding: 50, maxZoom: 17 } }
      : {}),
    minZoom,
    maxZoom: 21,
    attributionControl: false, // custom attribution control added below
    transformRequest: transformMapRequest,
    dragRotate: mapRotationEnabled.value,
    pitchWithRotate: mapRotationEnabled.value,
    aroundCenter: false, // otherwise the control scheme is ass
    rollEnabled: false,
    touchPitch: mapRotationEnabled.value, // two-finger pitch fights pinch-zoom, so it is gated behind the rotation opt-in
    maxPitch: 85,
  };
  // Lower sensitivity (default is 0.8).
  (mapOptions as Record<string, unknown>).rotateDegreesPerPixelMoved = 0.4;

  const newMap = new maplibre.Map(mapOptions);
  map.value = newMap;

  // The map does not capture keystrokes, so typing into overlaid UI panels never
  // pans/zooms the map.
  newMap.keyboard.disable();

  // Two-finger rotate on touch hijacks pinch-zoom, so it stays off unless the user opts into rotation.
  // Pinch-zoom remains available either way.
  if (mapRotationEnabled.value) {
    newMap.touchZoomRotate.enableRotation();
  } else {
    newMap.touchZoomRotate.disableRotation();
  }

  enableCursorTrackingScrollZoom(newMap);
  // Larger zoom step per mouse-wheel notch (MapLibre default is 1/450).
  newMap.scrollZoom.setWheelZoomRate(1 / 250);

  // Attribution is collected automatically from each active style's source `attribution`
  // fields, so it switches correctly between the plan basemap and satellite layers.
  newMap.addControl(new maplibre.AttributionControl({ compact: false }));

  currentZoomLevel.value = newMap.getZoom();
  newMap.on("zoomend", () => {
    currentZoomLevel.value = newMap.getZoom();
  });

  // Bearing/pitch drive the custom CompassControl (visibility + needle rotation). "move" fires
  // on every camera frame, including rotation inertia, so the needle stays locked to the map;
  // "moveend" guarantees it lands on the final bearing instead of drifting after a few gestures.
  function syncCameraOrientation() {
    currentBearing.value = newMap.getBearing();
    currentPitch.value = newMap.getPitch();
  }
  syncCameraOrientation();
  newMap.on("move", syncCameraOrientation);
  newMap.on("moveend", syncCameraOrientation);

  // Toggling the rotation setting locks/unlocks drag-rotate, pitch-with-rotate and two-finger
  // touch pitch; locking also snaps the camera back to north so the map never stays stuck at an angle.
  watch(mapRotationEnabled, (enabled) => {
    if (enabled) {
      newMap.dragRotate.enable();
      newMap.touchZoomRotate.enableRotation();
      newMap.touchPitch.enable();
    } else {
      newMap.dragRotate.disable();
      newMap.touchZoomRotate.disableRotation();
      newMap.touchPitch.disable();
      newMap.resetNorthPitch();
    }
  });
}

// eslint-disable-next-line no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.styleReady = styleReady;
  });
  import.meta.hot.accept();
}
