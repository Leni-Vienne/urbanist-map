import { loadCityProjects } from "@/composables/map/useCityMarkers";
import { prepareCountryContext } from "@/composables/map/useCountryMarkers";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo } from "@/composables/map/useMapNavigation";
import { prepareCrossCountryFlight } from "@/composables/map/useTileLayers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
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

  // AI : Prepare the country context FIRST (loads cities into store)
  // AI : This ensures coordinates will be available when we look them up
  await prepareCountryContext(countryCode);

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
      map.value!.once("moveend", () => resolve());
    });
  }

  // AI : Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, null, false, countryCode);
}
