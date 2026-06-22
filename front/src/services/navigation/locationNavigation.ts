import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { LngLatBounds } from "maplibre-gl";

type BoundaryBbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

// Cap how far fitting a boundary's bounds can zoom in, so a tiny neighborhood doesn't slam the
// camera to street level; large boundaries (countries, states) fit well under this anyway.
const MAX_BOUNDARY_ZOOM = 16;

/**
 * Navigate to a location on the map. Sets country context, then frames the boundary: fits its
 * bounding box when given (so the whole shape is visible at a fitting zoom), otherwise flies to the
 * provided point.
 */
export function navigateToCity(
  countryCode: string,
  target?: { bbox?: BoundaryBbox; coords?: { lat: number; lng: number } },
): void {
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  if (target?.bbox) {
    const { minLng, minLat, maxLng, maxLat } = target.bbox;
    const bounds = new LngLatBounds([minLng, minLat], [maxLng, maxLat]);
    mobileAwareFlyToBounds(bounds, { maxZoom: MAX_BOUNDARY_ZOOM });
  } else if (target?.coords) {
    mobileAwareFlyTo([target.coords.lat, target.coords.lng], 14);
  }
}
