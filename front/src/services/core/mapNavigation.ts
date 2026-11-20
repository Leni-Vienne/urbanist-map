import { LngLat, LngLatBounds, type JumpToOptions, type PaddingOptions } from "maplibre-gl";
import { getMap } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { isMobile } from "@/services/core/viewport";

// Existing callers pass arrays as [lat, lng]; MapLibre takes [lng, lat].
type LatLngInput = [number, number] | { lat: number; lng: number };

interface FlyOptions {
  mobileTopInset?: number;
  instant?: boolean;
}

interface FlyToBoundsOptions extends FlyOptions {
  /** Minimum destination zoom. A larger geometry may be clipped at this zoom. */
  minZoom?: number;
  maxZoom?: number;
}

const MOBILE_OVERLAY_TOP_INSET = 140;
export const MOBILE_CONTENT_TOP_INSET = 70;

/** Measure the map hidden by the drawer, including the mobile browser's URL bar. */
export function getMobileDrawerOcclusionPx(): number {
  if (!isMobile.value) return 0;
  const drawer = document.querySelector(".draggable-drawer");
  if (drawer) {
    const containerBottom = getMap().getContainer().getBoundingClientRect().bottom;
    return Math.max(0, containerBottom - drawer.getBoundingClientRect().top);
  }
  return (useUiStore().mobileDrawerHeightPercent / 100) * globalThis.innerHeight;
}

export function resolveMapPadding(mobileTopInset = MOBILE_OVERLAY_TOP_INSET): PaddingOptions {
  const { clientWidth, clientHeight } = getMap().getContainer();
  const padding = {
    top: isMobile.value ? mobileTopInset : 50,
    bottom: isMobile.value ? getMobileDrawerOcclusionPx() + 30 : 50,
    left: 50,
    right: 50,
  };
  // Leave at least one usable pixel so bounds fitting cannot divide by a negative size.
  if (padding.left + padding.right >= clientWidth) {
    padding.left = Math.max(0, (clientWidth - 1) / 2);
    padding.right = padding.left;
  }
  if (padding.top + padding.bottom >= clientHeight) {
    padding.top = Math.max(0, (clientHeight - 1) / 2);
    padding.bottom = padding.top;
  }
  return padding;
}

function toLngLat(input: LatLngInput): LngLat | null {
  const [lat, lng] = Array.isArray(input) ? input : [input.lat, input.lng];
  return Number.isFinite(lat) && Number.isFinite(lng) ? new LngLat(lng, lat) : null;
}

/** Apply one resolved destination, preserving short pans and instant deep-link framing. */
function moveCamera(camera: JumpToOptions, instant = false): void {
  const map = getMap();
  const distance = map.getCenter().distanceTo(LngLat.convert(camera.center ?? map.getCenter()));
  const zoomDiff = Math.abs(map.getZoom() - (camera.zoom ?? map.getZoom()));
  const currentPadding = map.getPadding();
  const samePadding =
    !camera.padding ||
    (["top", "bottom", "left", "right"] as const).every(
      (side) => currentPadding[side] === camera.padding?.[side],
    );
  if (
    distance < 10 &&
    zoomDiff < 0.1 &&
    (camera.bearing === undefined || camera.bearing === map.getBearing()) &&
    samePadding
  ) {
    return;
  }
  if (instant) {
    map.jumpTo(camera);
    return;
  }
  // Same-zoom moves use easeTo so recentering does not introduce a zoom-out arc.
  const duration =
    zoomDiff < 0.1 ? 300 : 300 + 1200 * Math.min(1, Math.max(distance / 5000, zoomDiff / 3));
  const animation = { ...camera, duration, essential: true };
  if (zoomDiff < 0.1) map.easeTo(animation);
  else map.flyTo(animation);
}

/** Center a point in the map area left visible above the mobile drawer. */
export function mobileAwareFlyTo(
  latlng: LatLngInput,
  zoom = getMap().getZoom(),
  options: FlyOptions = {},
): void {
  const center = toLngLat(latlng);
  if (!center) return;
  moveCamera({ center, zoom, padding: resolveMapPadding(options.mobileTopInset) }, options.instant);
}

/** Fit once, then use that exact destination for either animation or an instant move. */
export function mobileAwareFlyToBounds(
  bounds: LngLatBounds,
  options: FlyToBoundsOptions = {},
): void {
  const map = getMap();
  if (bounds.isEmpty() || !bounds.toArray().flat().every(Number.isFinite)) return;
  const isPoint = bounds.getWest() === bounds.getEast() && bounds.getSouth() === bounds.getNorth();
  const camera = map.cameraForBounds(bounds, {
    absolutePadding: true,
    padding: resolveMapPadding(options.mobileTopInset),
    maxZoom: options.maxZoom ?? (isPoint ? 17 : map.getMaxZoom()),
  });
  if (!camera) return;
  camera.zoom = Math.max(options.minZoom ?? map.getMinZoom(), camera.zoom ?? map.getZoom());
  moveCamera(camera, options.instant);
}

/** Frame a geometry by its size, zooming in when needed and otherwise only panning. */
export function flyToGeometry(latlng: LatLngInput, sizeM: number, options: FlyOptions = {}): void {
  const map = getMap();
  const center = toLngLat(latlng);
  if (!center) return;
  const padding = resolveMapPadding(options.mobileTopInset);
  const camera =
    sizeM > 0
      ? map.cameraForBounds(LngLatBounds.fromLngLat(center, sizeM / 2), {
          absolutePadding: true,
          padding,
          maxZoom: 15,
        })
      : null;
  const idealZoom = sizeM > 0 ? Math.max(7, camera?.zoom ?? map.getZoom()) : 14;
  moveCamera({ center, zoom: Math.max(map.getZoom(), idealZoom), padding }, options.instant);
}
