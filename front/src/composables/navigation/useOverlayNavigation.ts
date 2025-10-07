import { loadCitiesForCountry } from '@composables/map/useCountryMarkers';
import { removeCityMarkers, loadCityProjects, addCityMarkersForCountry } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { clearAllOverlays, navigateToOverlay } from '@composables/overlay/useOverlay';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { map } from '@composables/core/useMap';
import { useMapStore } from '@stores/pinia/mapStore';
import { useProjectStore } from '@stores/pinia/projectStore';

/**
 * AI : Navigates to an overlay by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker → overlay
 * @param overlayId - The ID of the overlay to navigate to
 * @param cityId - The city ID where the overlay is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlayWithCity(
  overlayId: string,
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<boolean> {
  try {
    const mapStore = useMapStore();
    const projectStore = useProjectStore();

    if (countryCode) {
      // AI : Step 1: Simulate country marker click
      // AI : Switch to appropriate tile layer
      switchTileLayer(isTileLayerType(countryCode) ? countryCode : 'esri');

      // AI : Clear previous state (exactly as country marker click does)
      removeCityMarkers();
      removeOverlayMarkers();
      clearAllOverlays();
      mapStore.currentCityOverlays = [];
      mapStore.clearSelectedCity();

      // AI : Load cities for the country
      await loadCitiesForCountry(countryCode);

      // AI : Get updated countries and add city markers
      const country = projectStore.countries.find((c: any) => c.code === countryCode);
      if (country) {
        addCityMarkersForCountry(country.cities.map((c: any) => ({ ...c, projectCount: 0 })));
      }
    }

    // AI : Step 2: Simulate city marker click (this loads and renders overlays)
    await loadCityProjects(cityId, cityName, false, countryCode);

    // AI : Step 3: Navigate to the overlay
    // AI : If the overlay was rendered by loadCityProjects, it will be selected
    // AI : If not, navigateToOverlay will fetch it from the backend
    return await navigateToOverlay(overlayId);
  } catch (error) {
    console.error('Failed to navigate to overlay with city:', error);
    throw error;
  }
}

/**
 * AI : Navigates to a development project by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker
 * @param lat - Latitude of the development project
 * @param lng - Longitude of the development project
 * @param cityId - The city ID where the development project is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 */
export async function navigateToMarkerProject(
  lat: number,
  lng: number,
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<void> {
  try {
    const mapStore = useMapStore();
    const projectStore = useProjectStore();

    if (countryCode) {
      // AI : Step 1: Simulate country marker click
      // AI : Switch to appropriate tile layer
      switchTileLayer(isTileLayerType(countryCode) ? countryCode : 'esri');

      // AI : Clear previous state (exactly as country marker click does)
      removeCityMarkers();
      removeOverlayMarkers();
      clearAllOverlays();
      mapStore.currentCityOverlays = [];
      mapStore.clearSelectedCity();

      // AI : Load cities for the country
      await loadCitiesForCountry(countryCode);

      // AI : Get updated countries and add city markers
      const country = projectStore.countries.find((c: any) => c.code === countryCode);
      if (country) {
        addCityMarkersForCountry(country.cities.map((c: any) => ({ ...c, projectCount: 0 })));
      }
    }

    // AI : Step 2: Load city projects (this loads and renders all markers and overlays for the city)
    await loadCityProjects(cityId, cityName, false, countryCode);

    // AI : Step 3: Fly to development project coordinates
    if (!map.value) {
      throw new Error('Map is not initialized');
    }

    map.value.flyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25
    });
  } catch (error) {
    console.error('Failed to navigate to development project:', error);
    throw error;
  }
}
