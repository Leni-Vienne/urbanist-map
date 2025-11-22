import { loadCitiesForCountry } from '@composables/map/useCountryMarkers';
import { removeCityMarkers, loadCityProjects, addCityMarkersForCountry } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { clearAllOverlays } from '@composables/overlay/useOverlayLifecycle';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { map } from '@composables/core/useMap';
import { mobileAwareFlyTo } from '@composables/map/useMapNavigation';
import { useMapStore } from '@stores/pinia/mapStore';
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
  const mapStore = useMapStore();
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

  // AI : Step 1: Prepare the country (switch tile layer, clear state, load cities)
  switchTileLayer(isTileLayerType(countryCode) ? countryCode : 'esri');

  removeCityMarkers();
  removeOverlayMarkers();
  clearAllOverlays();
  mapStore.currentCityOverlays = [];
  mapStore.clearSelectedCity();
  mapStore.selectedCountryCode = countryCode;

  // AI : Load cities for the country
  await loadCitiesForCountry(countryCode);

  // AI : Get the country with updated cities
  const country = projectStore.countries.find(c => c.code === countryCode);
  if (country) {
    addCityMarkersForCountry(country.cities.map(c => ({ ...c, projectCount: 0 })));

    // AI : Find the city to get its coordinates
    const city = country.cities.find(c => c.id === cityId);
    if (city && map.value) {
      // AI : Fly to the city
      mobileAwareFlyTo([city.lat, city.lng], 14, {
        duration: 1.5
      });
    }
  }

  // AI : Step 2: Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, false, countryCode);
}