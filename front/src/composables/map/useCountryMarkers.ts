import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { addCityMarkersForCountry, removeCityMarkers } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { clearAllOverlays } from '@composables/overlay/useOverlay';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { flyToCountry } from '@composables/map/useMapNavigation';
import { trpc } from '@client';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import { withErrorHandling } from '@composables/core/useErrorHandling';
import type { Country } from '@types';
import { MARKER_OPACITY } from '@constants/markerConstants';
import { createMarkerLayer, type MarkerLayerConfig } from '@composables/map/useMarkerLayer';

// AI : Function to get countries when needed
function getCountries() {
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  return countries;
}


// AI : Opacity constants are now imported from markerConstants

const isLoadingCountries = ref(false);
const isLoadingCountryProjects = ref(false);

let countryMarkersLayer: L.LayerGroup | null = null;

export async function loadCountriesWithProjects(force: boolean = false): Promise<void> {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // AI : Check if we have cached countries for this mode
  if (!force && projectStore.hasCachedCountries(overlayStore.mode)) {
    // AI : Use cached countries and update the active countries ref
    const cachedCountries = projectStore.getCachedCountries(overlayStore.mode);
    if (cachedCountries) {
      const countries = getCountries();
      countries.value = cachedCountries;
      return;
    }
  }

  isLoadingCountries.value = true;
  try {
    const countriesData = await withErrorHandling(
      async () => trpc.country.getCountriesWithProjects.query({ mode: overlayStore.mode }),
      { errorMessage: 'Failed to load countries. Please refresh the page.' }
    );

    if (countriesData) {
      const mappedCountries = countriesData.map((country): Country => ({
        ...country,
        lat: country.centerCoordinates.y,
        lng: country.centerCoordinates.x,
        projectCount: 0,
        cities: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // AI : Update both the active countries ref and cache
      const countries = getCountries();
      countries.value = mappedCountries;
      projectStore.setCachedCountries(overlayStore.mode, mappedCountries);
    }
  } finally {
    isLoadingCountries.value = false;
  }
}

export async function loadCitiesForCountry(countryCode: string): Promise<void> {
  const countries = getCountries();
  const country = countries.value.find((c: Country) => c.code === countryCode);

  if (!country) return;

  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  // AI : Check cache first for this country + mode combination
  if (projectStore.hasCachedCities(countryCode, overlayStore.mode)) {
    const cachedCities = projectStore.getCachedCities(countryCode, overlayStore.mode);
    if (cachedCities) {
      country.cities = cachedCities;
      return;
    }
  }

  isLoadingCountryProjects.value = true;
  try {
    // AI : Pass mode to show appropriate content based on viewing mode
    const citiesData = await withErrorHandling(
      async () => trpc.cities.getCitiesWithProjects.query({ countryCode, mode: overlayStore.mode }),
      { errorMessage: 'Failed to load cities. Please try again.' }
    );

    if (citiesData) {
      const cities = citiesData.map((city) => ({ ...city, distance: 0 }));
      country.cities = cities;
      // AI : Cache the cities for this country + mode
      projectStore.setCachedCities(countryCode, overlayStore.mode, cities);
    }
  } finally {
    isLoadingCountryProjects.value = false;
  }
}


export function addCountryMarkersToMap() {
  if (!map.value) {
    onMapInitialized(() => {
      addCountryMarkersToMapInternal();
    });
    return;
  }
  addCountryMarkersToMapInternal();
}

function addCountryMarkersToMapInternal() {
  if (!map.value) {
    return;
  }

  if (countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
  }

  const countries = getCountries();

  // AI : Configure country marker behavior
  const config: MarkerLayerConfig<Country> = {
    getOpacity: (hover) => hover ? MARKER_OPACITY.country.hover : MARKER_OPACITY.country.default,
    getColor: () => 'blue',
    getLatLng: (country) => ({ lat: country.lat, lng: country.lng }),
    getTooltip: (country) => country.name,
    getTestId: (country) => `country-marker-${country.code}`,
    getDataAttributes: (country) => ({
      'data-country-code': country.code,
      'data-country-name': country.name,
      'data-lat': country.lat.toString(),
      'data-lng': country.lng.toString(),
    }),
    onMarkerClick: async (_marker, country) => {
      // AI : Warn if there are unsaved overlays before switching countries
      const overlayStore = useOverlayStore();
      const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
        overlay => overlay.isModified === true
      );

      if (hasUnsavedOverlays) {
        const confirmed = confirm(
          'You have unsaved overlays. Switching to another country will discard them. Continue?'
        );
        if (!confirmed) {
          return; // AI : User cancelled, don't switch countries
        }
      }

      // AI : Fly to the country using bounding box
      flyToCountry(country.code, country.lat, country.lng);

      // AI : Automatically switch to the appropriate tile layer for this country
      switchTileLayer(isTileLayerType(country.code) ? country.code : 'esri');

      // AI : Clear previous city markers, overlays and selected city state before loading new ones
      removeCityMarkers();
      removeOverlayMarkers();
      clearAllOverlays();
      const mapStore = useMapStore();
      mapStore.currentCityOverlays = [];
      mapStore.clearSelectedCity();

      // AI : Set the selected country code
      mapStore.selectedCountryCode = country.code;

      // AI : Load cities (cache will handle whether to fetch from backend or use cached data)
      await loadCitiesForCountry(country.code);
      const updatedCountries = getCountries();
      const updatedCountry = updatedCountries.value.find((c: Country) => c.code === country.code);
      if (updatedCountry) {
        addCityMarkersForCountry(updatedCountry.cities.map((c) => ({ ...c, projectCount: 0 })));
      }
    }
  };

  // AI : Create marker layer using abstraction
  const result = createMarkerLayer(countries.value, config);
  countryMarkersLayer = result.layer;

  // AI : Add the layer group to the map
  countryMarkersLayer.addTo(map.value);
}

export async function initializeCountryMarkers(): Promise<void> {
  await loadCountriesWithProjects();
  addCountryMarkersToMap();
}
