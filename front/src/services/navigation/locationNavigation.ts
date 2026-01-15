import { loadCityProjects } from "@/services/map/cityMarkers";
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { prepareCrossCountryFlight } from "@/services/map/tileLayers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { t } from "@/locales";

/**
 * AI : Navigate to a city on the map
 * AI : This simulates clicking on a country marker then a city marker
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
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // AI : Check for unsaved overlays before navigating
  const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.isModified === true,
  );

  if (hasUnsavedOverlays) {
    const confirmed = confirm(t("navigation.unsavedOverlaysWarning"));
    if (!confirmed) {
      return;
    }
  }

  // AI : Prepare for cross-country flight (switches to esri if needed)
  const switchToCountryLayer = prepareCrossCountryFlight(countryCode);

  // AI : Clear map and load cities for the country
  clearAllMapContent();
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;
  await loadCitiesForCountry(countryCode);

  // AI : Find the city coordinates (from store or provided coords)
  let lat: number | undefined = undefined;
  let lng: number | undefined = undefined;

  if (cityCoords) {
    // AI : Use provided coordinates (from search result)
    lat = cityCoords.lat;
    lng = cityCoords.lng;
  } else {
    // AI : Try to find in store (should now be available after prepareCountryContext)
    const country = projectStore.countries.find((c) => c.code === countryCode);
    const city = country?.cities.find((c) => c.id === cityId);
    if (city) {
      lat = city.lat;
      lng = city.lng;
    }
  }

  // AI : Fly to city coordinates if we have them
  if (lat !== undefined && lng !== undefined && map.value) {
    mobileAwareFlyTo([lat, lng], 14, {
      duration: 1.5,
    });

    // AI : If cross-country flight, switch to country layer after arrival
    if (switchToCountryLayer) {
      map.value.once("moveend", switchToCountryLayer);
    }

    // AI : Wait for the fly animation to complete before loading city data
    await new Promise<void>((resolve) => {
      map.value?.once("moveend", () => resolve());
    });
  }

  // AI : Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, null, false, countryCode);
}
