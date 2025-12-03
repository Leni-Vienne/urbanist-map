import { loadCityProjects } from '@composables/map/useCityMarkers';
import { prepareCountryContext } from '@composables/map/useCountryMarkers';
import { map } from '@composables/core/useMap';
import { mobileAwareFlyTo } from '@composables/map/useMapNavigation';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';

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
  countryCode: string
): Promise<void> {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // AI : Check for unsaved overlays before navigating
  const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
    overlay => overlay.isModified === true
  );

  if (hasUnsavedOverlays) {
    const confirmed = confirm(
      'You have unsaved overlays. Navigating will discard them. Continue?'
    );
    if (!confirmed) {
      return;
    }
  }

  // AI : Step 1: Prepare the country (switch tile layer, clear state, load cities, add city markers)
  await prepareCountryContext(countryCode);

  // AI : Fly to the city coordinates
  const country = projectStore.countries.find(c => c.code === countryCode);
  if (country) {
    const city = country.cities.find(c => c.id === cityId);
    if (city && map.value) {
      mobileAwareFlyTo([city.lat, city.lng], 14, {
        duration: 1.5
      });
    }
  }

  // AI : Step 2: Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, false, countryCode);
}