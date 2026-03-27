import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";

/**
 * Navigate to a city on the map
 * @param cityId - The city ID to navigate to
 * @param cityName - The city name (for display)
 * @param countryCode - The country code where the city is located
 * @param cityCoords - Optional city coordinates (used when city not yet loaded in store)
 * @returns Promise that resolves when navigation is complete
 */
export async function navigateToCity(
  cityId: number,
  cityName: string,
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): Promise<void> {
  const projectStore = useProjectStore();

  // Clear city-specific content before navigating to new city
  clearAllMapContent();
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;
  await loadCitiesForCountry(countryCode);

  // Find the city coordinates (from store or provided coords)
  let lat: number | undefined = undefined;
  let lng: number | undefined = undefined;

  if (cityCoords) {
    // Use provided coordinates (from search result)
    lat = cityCoords.lat;
    lng = cityCoords.lng;
  } else {
    // Try to find in store (should now be available after prepareCountryContext)
    const country = projectStore.countries.find((c) => c.code === countryCode);
    const city = country?.cities.find((c) => c.id === cityId);
    if (city) {
      lat = city.lat;
      lng = city.lng;
    }
  }

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
