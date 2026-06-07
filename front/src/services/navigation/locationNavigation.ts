import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";

/** Navigate to a location on the map. Sets country context and flies to the given coordinates. */
export function navigateToCity(
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): void {
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  if (cityCoords) {
    mobileAwareFlyTo([cityCoords.lat, cityCoords.lng], 14);
  }
}
