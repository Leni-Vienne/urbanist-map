// AI : Country data loading composable (no marker rendering)
// AI : Extracted from useCountryMarkers.ts to separate data loading from UI rendering
import { ref } from "vue";
import { addCityMarkersForCountry, removeCityMarkers } from "@/composables/map/useCityMarkers";
import { removeOverlayMarkers } from "@/composables/map/useCityOverlays";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/composables/map/useStandaloneProjectMarkers";
import { trpc } from "@/client";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { storeToRefs } from "pinia";
import { withErrorHandling } from "@/composables/core/useErrorHandling";
import type { Country } from "@/types/index";
import countryBboxes from "@/assets/country_bboxes.json";

// AI : Type guard to validate country code against countryBboxes keys
export function isValidCountryCode(code: string): code is keyof typeof countryBboxes {
  return code in countryBboxes;
}

// AI : Function to get countries when needed
function getCountries() {
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  return countries;
}

const isLoadingCountries = ref(false);
const isLoadingCountryProjects = ref(false);

/**
 * AI : Load countries with projects from backend
 * AI : This loads country data for breadcrumbs and navigation (no markers rendered)
 */
export async function loadCountriesWithProjects(force = false): Promise<void> {
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
    // AI : For unauthenticated users, ensure we always use 'view' mode
    const authStore = useAuthStore();
    const queryMode = authStore.isAuthenticated ? overlayStore.mode : "view";

    const countriesData = await withErrorHandling(
      async () => trpc.country.getCountriesWithProjects.query({ mode: queryMode }),
      { errorMessage: "Failed to load countries. Please refresh the page." },
    );

    if (countriesData) {
      const mappedCountries = countriesData.map(
        (country): Country =>
          Object.assign(country, {
            lat: country.centerCoordinates.y,
            lng: country.centerCoordinates.x,
            projectCount: 0,
            cities: [],
            code2: country.code2 ?? "", // AI : Temporary default until GeoNames import populates alpha-2 codes
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
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

/**
 * AI : Load cities for a specific country
 */
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
    // AI : For unauthenticated users, ensure we always use 'view' mode
    const authStore = useAuthStore();
    const queryMode = authStore.isAuthenticated ? overlayStore.mode : "view";

    // AI : Pass mode to show appropriate content based on viewing mode
    const citiesData = await withErrorHandling(
      async () => trpc.cities.getCitiesWithProjects.query({ countryCode, mode: queryMode }),
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
 * AI : This is called when switching between countries or logging out
 */
export function clearAllMapContent(): void {
  removeCityMarkers();
  removeOverlayMarkers();
  clearAllOverlays();
  clearAllStandaloneProjectMarkers();
  const mapStore = useMapStore();
  mapStore.currentCityOverlays = [];
  mapStore.clearSelectedCity();
}
