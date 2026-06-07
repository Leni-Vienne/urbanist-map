import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";

/** Navigate to a location on the map. Sets country context and flies to the given coordinates. */
export async function navigateToCity(
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): Promise<void> {
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  const lat = cityCoords?.lat;
  const lng = cityCoords?.lng;

  if (lat !== undefined && lng !== undefined && mobileAwareFlyTo([lat, lng], 14)) {
    await new Promise<void>((resolve) => {
      map.value.once("moveend", () => {
        resolve();
      });
    });
  }
}
