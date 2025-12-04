import type L from "leaflet";
import { ref } from "vue";
import { map } from "@composables/core/useMap";
import { flyToCountry } from "@composables/map/useMapNavigation";
import { addCityMarkersForCountry, removeCityMarkers } from "@composables/map/useCityMarkers";
import { removeOverlayMarkers } from "@composables/map/useCityOverlays";
import { clearAllOverlays } from "@composables/overlay/useOverlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@composables/map/useStandaloneProjectMarkers";
import { switchTileLayer, isTileLayerType } from "@composables/map/useTileLayers";
import { trpc } from "@client";
import { useProjectStore } from "@stores/pinia/projectStore";
import { useMapStore } from "@stores/pinia/mapStore";
import { useOverlayStore } from "@stores/pinia/overlayStore";
import { storeToRefs } from "pinia";
import { withErrorHandling } from "@composables/core/useErrorHandling";
import type { Country } from "@types";
import { MARKER_OPACITY } from "@constants/markerConstants";
import { createMarkerLayer, type MarkerLayerConfig } from "@composables/map/useMarkerLayer";
import countryBboxes from "@assets/country_bboxes.json";

// AI : Type guard to validate country code against countryBboxes keys
function isValidCountryCode(code: string): code is keyof typeof countryBboxes {
  return code in countryBboxes;
}

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
      { errorMessage: "Failed to load countries. Please refresh the page." },
    );

    if (countriesData) {
      const mappedCountries = countriesData.map(
        (country): Country => (Object.assign(country, {lat:country.centerCoordinates.y,lng:country.centerCoordinates.x,projectCount:0,cities:[],createdAt:new Date,updatedAt:new Date})),
      );

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
      { errorMessage: "Failed to load cities. Please try again." },
    );

    if (citiesData) {
      const cities = citiesData.map((city) => {
        return Object.assign({}, city, { distance: 0 });
      });
      country.cities = cities;
      // AI : Cache the cities for this country + mode
      projectStore.setCachedCities(countryCode, overlayStore.mode, cities);
    }
  } finally {
    isLoadingCountryProjects.value = false;
  }
}

/**
 * AI : Clear all map content (markers, overlays, and state)
 * AI : This is called when switching between countries
 */
function clearAllMapContent(): void {
  removeCityMarkers();
  removeOverlayMarkers();
  clearAllOverlays();
  clearAllStandaloneProjectMarkers();
  const mapStore = useMapStore();
  mapStore.currentCityOverlays = [];
  mapStore.clearSelectedCity();
}

/**
 * AI : Prepare country context by switching tile layer, clearing map, and loading cities
 * AI : This is the common flow when navigating to a country
 * @param countryCode - The country code to prepare context for
 */
export async function prepareCountryContext(countryCode: string): Promise<void> {
  // AI : Step 1: Switch to appropriate tile layer for this country
  switchTileLayer(isTileLayerType(countryCode) ? countryCode : "esri");

  // AI : Step 2: Clear all previous map content
  clearAllMapContent();

  // AI : Step 3: Set the selected country code
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;

  // AI : Step 4: Load cities for the country
  await loadCitiesForCountry(countryCode);

  // AI : Step 5: Add city markers to the map
  const projectStore = useProjectStore();
  const country = projectStore.countries.find((c) => c.code === countryCode);
  if (country) {
    addCityMarkersForCountry(
      country.cities.map((city) => {
        return Object.assign({}, city, { projectCount: 0 });
      }),
    );
  }
}

export function addCountryMarkersToMap() {
  if (!map.value) {
    console.error("Map not initialized when trying to add country markers");
    return;
  }

  if (countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
  }

  const countries = getCountries();

  // AI : Configure country marker behavior
  const config: MarkerLayerConfig<Country> = {
    getOpacity: (hover) => (hover ? MARKER_OPACITY.country.hover : MARKER_OPACITY.country.default),
    getColor: () => "blue",
    getLatLng: (country) => ({ lat: country.lat, lng: country.lng }),
    getTooltip: (country) => country.name,
    getTestId: (country) => `country-marker-${country.code}`,
    getDataAttributes: (country) => ({
      "data-country-code": country.code,
      "data-country-name": country.name,
      "data-lat": country.lat.toString(),
      "data-lng": country.lng.toString(),
    }),
    onMarkerClick: async (_marker, country) => {
      // AI : Warn if there are unsaved overlays before switching countries
      const overlayStore = useOverlayStore();
      const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
        (overlay) => overlay.isModified === true,
      );

      if (hasUnsavedOverlays) {
        const confirmed = confirm(
          "You have unsaved overlays. Switching to another country will discard them. Continue?",
        );
        if (!confirmed) {
          return; // AI : User cancelled, don't switch countries
        }
      }

      // AI : Fly to the country using bounding box
      if (isValidCountryCode(country.code)) {
        flyToCountry(country.code, country.lat, country.lng);
      }

      // AI : Prepare country context (switch tile layer, clear map, load cities, add city markers)
      await prepareCountryContext(country.code);
    },
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
