import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { addCityMarkersForCountry, removeCityMarkers, resetLayerMarkersOpacity } from '@composables/map/useCityMarkers';
import { removeOverlayMarkers } from '@composables/map/useCityOverlays';
import { clearAllOverlays } from '@composables/overlay/useOverlay';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { flyToCountry } from '@composables/map/useFlyToCountry';
import { trpc } from '@client';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import { createColorIcon } from '@composables/ui/markerIcons';
import { withErrorHandling } from '@composables/core/useErrorHandling';
import type { Country } from '@types';

// AI : Function to get countries when needed
function getCountries() {
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  return countries;
}


// AI : Opacity constants for country markers
const COUNTRY_MARKER_OPACITY = 0.6; // AI : Default opacity for country markers
const COUNTRY_MARKER_HOVER_OPACITY = 1; // AI : Opacity for country markers on hover

const isLoadingCountries = ref(false);
const isLoadingCountryProjects = ref(false);

let countryMarkersLayer: L.LayerGroup | null = null;

// AI : Track the currently selected (clicked) country marker
let selectedCountryMarker: L.Marker | null = null;

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

  countryMarkersLayer = L.layerGroup();
  const countries = getCountries();
  countries.value.forEach((country) => {
    // AI : Create SVG marker for countries (using blue color)
    const markerIcon = createColorIcon('blue');
    const marker = L.marker([country.lat, country.lng], {
      icon: markerIcon,
      opacity: COUNTRY_MARKER_OPACITY, // AI : Lower default opacity to suggest interactivity
    });

    // AI : Add data-testid to the marker element after it's added to the DOM
    marker.on('add', () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute('data-testid', `country-marker-${country.code}`);
        markerElement.setAttribute('data-country-code', country.code);
        markerElement.setAttribute('data-country-name', country.name);
        markerElement.setAttribute('data-lat', country.lat.toString());
        markerElement.setAttribute('data-lng', country.lng.toString());
      }
    });

    // AI : Add tooltip with country name, only on hover
    marker.bindTooltip(country.name, {
      permanent: false, // AI : Tooltip appears only on hover
    });

    // AI : Add click event to load cities and set marker as selected
    marker.on('click', async () => {
      resetLayerMarkersOpacity(countryMarkersLayer, COUNTRY_MARKER_OPACITY);
      marker.setOpacity(COUNTRY_MARKER_HOVER_OPACITY);
      selectedCountryMarker = marker;

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
    });

    // AI : Add mouseover event to show guidance tooltip and increase marker opacity
    marker.on('mouseover', () => {
      // AI : Only increase opacity if not selected
      if (selectedCountryMarker !== marker) {
        marker.setOpacity(COUNTRY_MARKER_HOVER_OPACITY);
      }
    });

    // AI : Add mouseout event to hide guidance tooltip and reset marker opacity if not selected
    marker.on('mouseout', () => {
      // AI : Only reset opacity if not selected
      if (selectedCountryMarker !== marker) {
        marker.setOpacity(COUNTRY_MARKER_OPACITY);
      }
    });

    countryMarkersLayer!.addLayer(marker);
  });

  countryMarkersLayer.addTo(map.value);

  // AI : Reset selected marker when new markers are added
  selectedCountryMarker = null;
}

export async function initializeCountryMarkers(): Promise<void> {
  await loadCountriesWithProjects();
  addCountryMarkersToMap();
}
