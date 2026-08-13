import * as maplibre from "maplibre-gl";
import type { Map as MaplibreMap, RequestParameters } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"; // needed for maplibre controls and attribution styling
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { ref, shallowRef } from "vue";
import { getApiUrl } from "@/utils/apiUrl";
import { mapRotationEnabled } from "@/services/core/settings";

// Registers the bundled worker URL used by every Map instance. Must run before the first Map
// is constructed.
maplibre.setWorkerUrl(workerUrl);

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

// Closest zoom a deep link frames its project at. The boot fit and the refit that follows share it,
// so a cold deep link does not re-zoom once the project resolves.
export const DEEPLINK_FIT_MAX_ZOOM = 17;

export const currentZoomLevel = ref(12);
export const currentBearing = ref(0);
export const currentPitch = ref(0);

// The MapLibre instance MapView currently owns, or null while no map is mounted (any non-map route).
const currentMap = shallowRef<MaplibreMap | null>(null);

/** The mounted map. Throws when none is: use it only where MapView is known to be mounted. */
export function getMap(): MaplibreMap {
  const value = currentMap.value;
  if (!value) throw new Error("Map is not mounted");
  return value;
}

/** The mounted map, or null. Use it in browser-session code that can run on a non-map route. */
export function getMapOrNull(): MaplibreMap | null {
  return currentMap.value;
}

// "Ready" is a property of one map instance, not of the module: a new map starts unready and must
// never inherit the previous one's readiness. Callbacks queued for a map that gets destroyed before
// it loads are dropped with it.
let readyMap: MaplibreMap | null = null;
const readyCallbacks = new Set<(target: MaplibreMap) => void>();

/**
 * Run `run` once the current map's style is loaded and its project layers are wired up, immediately
 * if that already happened. Returns an unsubscribe function, which a component must call on unmount
 * so its callback cannot run against a later map.
 */
export function onMapReady(run: (target: MaplibreMap) => void): () => void {
  if (readyMap !== null && readyMap === currentMap.value) {
    run(readyMap);
    return function alreadyRan(): void {
      /* nothing queued */
    };
  }

  readyCallbacks.add(run);
  return function unsubscribeMapReady(): void {
    readyCallbacks.delete(run);
  };
}

/** Mark `target` ready and flush the queued callbacks. Called on its first style load. */
export function markMapReady(target: MaplibreMap): void {
  if (currentMap.value !== target) return;
  readyMap = target;

  const pending = [...readyCallbacks];
  readyCallbacks.clear();
  for (const run of pending) run(target);
}

function resetMapReadiness(): void {
  readyMap = null;
  readyCallbacks.clear();
}

// setStyle() destroys every source and layer on the map. "before" fires while the outgoing style's
// objects are still live, "after" once the incoming style has loaded and its layers are rebuilt.
// Listeners are not scoped to a map instance and survive a remount, so module-level owners can
// subscribe once at load.
export type StyleSwitchPhase = "before" | "after";

const styleSwitchCallbacks = new Set<(phase: StyleSwitchPhase) => void>();

/** Run `run` on both phases of every basemap style swap, for the lifetime of the page. */
export function onStyleSwitch(run: (phase: StyleSwitchPhase) => void): void {
  styleSwitchCallbacks.add(run);
}

/** Run every style-switch listener for `phase`. A listener that throws does not stop the others. */
export function emitStyleSwitch(phase: StyleSwitchPhase): void {
  for (const run of [...styleSwitchCallbacks]) {
    try {
      run(phase);
    } catch (error) {
      console.error("Style-switch listener failed:", error);
    }
  }
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
  // MapLibre types `_aroundPoint` as always present, but only assigns it once a gesture starts,
  // so it is undefined on the wheel events that precede one.
  // eslint-disable-next-line no-unsafe-type-assertion
  const handler = targetMap.scrollZoom as Omit<MaplibreMap["scrollZoom"], "_aroundPoint"> & {
    _aroundPoint?: { x: number; y: number };
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
    const rect = canvas.getBoundingClientRect();
    handler._aroundPoint.x = e.clientX - rect.left - canvas.clientLeft;
    handler._aroundPoint.y = e.clientY - rect.top - canvas.clientTop;
  };
  /* eslint-enable no-underscore-dangle */
}

function createMapOptions(): maplibre.MapOptions {
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
  if (deeplinkBounds) {
    mapOptions.bounds = deeplinkBounds;
    mapOptions.fitBoundsOptions = { padding: 50, maxZoom: DEEPLINK_FIT_MAX_ZOOM };
  }
  return mapOptions;
}

// Interaction tuning, controls, and the camera refs mirroring the instance. Every listener here is
// owned by MapLibre and dies with the map, so none needs an external disposer.
function configureMap(target: MaplibreMap): void {
  // The map does not capture keystrokes, so typing into overlaid UI panels never
  // pans/zooms the map.
  target.keyboard.disable();

  // Two-finger rotate on touch hijacks pinch-zoom, so it stays off unless the user opts into
  // rotation. Pinch-zoom remains available either way.
  if (mapRotationEnabled.value) {
    target.touchZoomRotate.enableRotation();
  } else {
    target.touchZoomRotate.disableRotation();
  }

  enableCursorTrackingScrollZoom(target);
  // Larger zoom step per mouse-wheel notch (MapLibre default is 1/450).
  target.scrollZoom.setWheelZoomRate(1 / 250);

  // Attribution is collected automatically from each active style's source `attribution`
  // fields, so it switches correctly between the plan basemap and satellite layers.
  target.addControl(new maplibre.AttributionControl({ compact: false }));

  currentZoomLevel.value = target.getZoom();
  function syncZoom(): void {
    currentZoomLevel.value = target.getZoom();
  }
  target.on("zoomend", syncZoom);

  // Bearing/pitch drive the custom CompassControl (visibility + needle rotation). "move" fires
  // on every camera frame, including rotation inertia, so the needle stays locked to the map;
  // "moveend" guarantees it lands on the final bearing instead of drifting after a few gestures.
  function syncCameraOrientation(): void {
    currentBearing.value = target.getBearing();
    currentPitch.value = target.getPitch();
  }
  syncCameraOrientation();
  target.on("move", syncCameraOrientation);
  target.on("moveend", syncCameraOrientation);
}

/**
 * Build the MapLibre instance and publish it as the current map. Refuses to replace a live instance:
 * a leftover map means the previous MapView never tore itself down.
 */
export function createMap(): MaplibreMap {
  if (currentMap.value) throw new Error("Map is already mounted");

  const target = new maplibre.Map(createMapOptions());
  currentMap.value = target;
  configureMap(target);
  return target;
}

/**
 * Remove `target` and expose no current map. The identity check keeps a late cleanup from an old
 * MapView from destroying a newer map.
 */
export function destroyMap(target: MaplibreMap): void {
  if (currentMap.value !== target) return;
  target.remove();
  currentMap.value = null;
  resetMapReadiness();
}
