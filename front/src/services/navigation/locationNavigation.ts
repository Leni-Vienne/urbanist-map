import { clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";

/**
 * Navigate to a city on the map
 * @param countryCode - The country code where the city is located
 * @param cityCoords - Optional city coordinates (used when city not yet loaded in store)
 * @returns Promise that resolves when navigation is complete
 */
export async function navigateToCity(
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): Promise<void> {
  // Clear city-specific content before navigating to new city
  clearAllMapContent();
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  // Use provided coordinates (from search result)
  const lat = cityCoords?.lat;
  const lng = cityCoords?.lng;

  // Fly to city coordinates if we have them
  if (lat !== undefined && lng !== undefined) {
    mobileAwareFlyTo([lat, lng], 14, {
      duration: 1.5,
    });

    // Wait for the fly animation to complete before loading city data
    await new Promise<void>((resolve) => {
      map.value.once("moveend", () => {
        resolve();
      });
    });
  }
}
