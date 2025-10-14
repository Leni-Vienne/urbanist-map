import L from 'leaflet';
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers';
import { removeCityMarkers, loadCityProjects, addCityMarkersForCountry } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { clearAllOverlays, navigateToOverlay } from '@composables/overlay/useOverlay';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { map } from '@composables/core/useMap';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';

/**
 * AI : Shared logic for navigating to a location by simulating country → city marker clicks
 * AI : This loads the country cities, adds city markers, and loads city projects
 */
async function prepareNavigationToCity(
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<void> {
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

    // AI : Set selected country code so edit mode can reload cities properly
    mapStore.selectedCountryCode = countryCode;

    // AI : Load cities for the country
    await loadCitiesForCountry(countryCode);

    // AI : Get updated countries and add city markers
    const country = projectStore.countries.find((country) => country.code === countryCode);
    if (country) {
      addCityMarkersForCountry(country.cities.map((city) => ({ ...city, projectCount: 0 })));
    }
  }

  // AI : Step 2: Simulate city marker click (this loads and renders all markers and overlays for the city)
  await loadCityProjects(cityId, cityName, false, countryCode);
}

/**
 * AI : Zoom to overlay and select it once rendered
 */
function zoomToOverlayAndSelect(overlayId: string, corners: { lat: number; lng: number }[]): boolean {
  if (!map.value || corners.length !== 4) {
    return false;
  }

  const bounds = L.latLngBounds(corners.map(c => L.latLng(c.lat, c.lng)));
  map.value.flyToBounds(bounds, { padding: [50, 50] as [number, number], duration: 1.5, easeLinearity: 0.25 });

  // AI : Select the overlay once zoom completes
  map.value.once('moveend', () => {
    const overlayStore = useOverlayStore();

    const trySelectOverlay = () => {
      const overlayObject = overlayStore.overlays[overlayId];
      if (overlayObject?.overlay) {
        const element = overlayObject.overlay.getElement();
        if (element) {
          element.click();
          return true;
        }
      }
      return false;
    };

    if (trySelectOverlay()) {
      return;
    }

    // AI : Poll for overlay to be rendered
    let attempts = 0;
    const maxAttempts = 20;
    const pollInterval = setInterval(() => {
      attempts++;

      if (trySelectOverlay() || attempts >= maxAttempts) {
        clearInterval(pollInterval);
      }
    }, 100);
  });

  return true;
}

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
    const overlayStore = useOverlayStore();

    // AI : Optimization 1: Check if clicking the same overlay again
    if (overlayStore.idSelectedOverlay === overlayId) {
      const overlayObject = overlayStore.overlays[overlayId];
      if (overlayObject?.corners) {
        zoomToOverlayAndSelect(overlayId, overlayObject.corners);
      }
      return true;
    }

    // AI : Optimization 2: Check if overlay is from the currently selected city
    const currentCity = mapStore.selectedCity;
    const isSameCity = currentCity?.id === cityId;

    if (isSameCity) {
      const overlayData = mapStore.currentCityOverlays.find(o => o.id === overlayId);
      if (overlayData?.corners) {
        return zoomToOverlayAndSelect(overlayId, overlayData.corners);
      }
    }

    // AI : Different city or no data - load everything
    await prepareNavigationToCity(cityId, cityName, countryCode);

    if (!map.value) {
      return false;
    }

    // AI : Get the overlay data from mapStore (already loaded by getCityOverlaysAndProjects)
    const overlayData = mapStore.currentCityOverlays.find(o => o.id === overlayId);

    if (overlayData?.corners) {
      return zoomToOverlayAndSelect(overlayId, overlayData.corners);
    }

    // AI : Fallback: if overlay not in current city overlays, use the old method
    return await navigateToOverlay(overlayId, true, false);
  } catch (error) {
    console.error('Failed to navigate to overlay with city:', error);
    throw error;
  }
}

/**
 * AI : Navigates to a marker project by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker
 * @param lat - Latitude of the marker project
 * @param lng - Longitude of the marker project
 * @param cityId - The city ID where the marker project is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 */
export async function navigateToDevelopmentProject(
  lat: number,
  lng: number,
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<void> {
  try {
    // AI : Prepare navigation (load country cities and city projects)
    await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : Fly to marker project coordinates
    if (!map.value) {
      throw new Error('Map is not initialized');
    }

    map.value.flyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25
    });
  } catch (error) {
    console.error('Failed to navigate to marker project:', error);
    throw error;
  }
}
