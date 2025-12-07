import { loadCityProjects } from "@/composables/map/useCityMarkers";
import { prepareCountryContext } from "@/composables/map/useCountryMarkers";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo } from "@/composables/map/useMapNavigation";
import { prepareCrossCountryFlight } from "@/composables/map/useTileLayers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useI18n } from '@/composables/useI18n';

/**
 * AI : Navigate to a city on the map
 * AI : This simulates clicking on a country marker then a city marker
 * @param cityId - The city ID to navigate to
 * @param cityName - The city name (for display)
 * @param countryCode - The country code where the city is located
 * @returns Promise that resolves when navigation is complete
 */
export async function navigateToCity(
  cityId: string,
  cityName: string,
  countryCode: string,
): Promise<void> {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const { t } = useI18n();

  // AI : Check for unsaved overlays before navigating
  const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.isModified === true,
  );

  if (hasUnsavedOverlays) {
    const confirmed = confirm(t('navigation.unsavedOverlaysWarning'));
    if (!confirmed) {
      return;
    }
  }

  // AI : Prepare for cross-country flight (switches to esri if needed)
  const switchToCountryLayer = prepareCrossCountryFlight(countryCode);

  // AI : Find the city coordinates and fly to them
  const country = projectStore.countries.find((c) => c.code === countryCode);
  const city = country?.cities.find((c) => c.id === cityId);

  if (city && map.value) {
    mobileAwareFlyTo([city.lat, city.lng], 14, {
      duration: 1.5,
    });

    // AI : If cross-country flight, switch to country layer after arrival
    if (switchToCountryLayer) {
      map.value.once("moveend", switchToCountryLayer);
    }
  }

  // AI : Prepare the country (clear map, load cities, add markers)
  await prepareCountryContext(countryCode);

  // AI : Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, false, countryCode);
}
