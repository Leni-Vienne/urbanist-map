import { clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";

/** Navigate to a location on the map. Clears existing map content, sets country context, and flies to the given coordinates. */
export async function navigateToCity(
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): Promise<void> {
  clearAllMapContent();
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  const lat = cityCoords?.lat;
  const lng = cityCoords?.lng;

  if (lat !== undefined && lng !== undefined) {
    mobileAwareFlyTo([lat, lng], 14, {
      duration: 1.5,
    });

    await new Promise<void>((resolve) => {
      map.value.once("moveend", () => {
        resolve();
      });
    });
  }
}
