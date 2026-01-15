// AI : Country data loading composable (no marker rendering)
// AI : Extracted from useCountryMarkers.ts to separate data loading from UI rendering
import { ref } from "vue";
import { removeCityMarkers } from "@/services/map/cityMarkers";
import { removeOverlayMarkers } from "@/services/map/cityOverlays";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { trpc } from "@/client";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { withErrorHandling } from "@/services/core/errorHandling";
import type { Country } from "@/types/index";
import countryBboxes from "@/assets/country_bboxes.json";

// AI : Type guard to validate country code against countryBboxes keys
export function isValidCountryCode(code: string): code is keyof typeof countryBboxes {
  return code in countryBboxes;
}

export interface CountryInfo {
  code: string;
  name: string;
}

/**
 * AI : Helper to get country name from country code
 */
export function getCountryName(
  countryCode: string | null | undefined,
  countries: CountryInfo[],
): string | null {
  if (!countryCode) return null;
  const country = countries.find((c) => c.code === countryCode);
  return country?.name ?? null;
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
      projectStore.countries = cachedCountries;
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
      projectStore.countries = mappedCountries;
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
  const projectStore = useProjectStore();
  const country = projectStore.countries.find((c: Country) => c.code === countryCode);

  if (!country) return;

  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const queryMode = authStore.isAuthenticated ? overlayStore.mode : "view";

  // AI : Check per-country cache first
  if (projectStore.hasCachedCities(countryCode, queryMode)) {
    const cachedCities = projectStore.getCachedCities(countryCode, queryMode);
    if (cachedCities) {
      country.cities = cachedCities;
      return;
    }
  }

  // AI : OPTIMIZATION: Check global cities cache before making API call
  // AI : This prevents duplicate getCitiesWithProjects calls when global cities are already loaded
  const globalCities = await projectStore.fetchCitiesWithProjects(queryMode);
  if (globalCities && globalCities.length > 0) {
    const countryCities = globalCities
      .filter((city: any) => city.countryCode === countryCode)
      .map((city: any) => Object.assign({}, city, { distance: 0 }));

    if (countryCities.length > 0) {
      country.cities = countryCities;
      // AI : Cache the filtered cities for this country + mode
      projectStore.setCachedCities(countryCode, queryMode, countryCities);
      return;
    }
  }

  // AI : Fallback: If no cities found in global cache, make country-specific API call
  // AI : This handles edge cases where global cache might be incomplete
  isLoadingCountryProjects.value = true;
  try {
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
      projectStore.setCachedCities(countryCode, queryMode, cities);
    }
  } finally {
    isLoadingCountryProjects.value = false;
  }
}

/**
 * AI : Clear all map content (markers, overlays, cache, and state)
 * AI : This is called when switching between countries or logging out
 * AI : Uses clearAllRenderedContent to ensure viewModeOverlays cache is also cleared
 */
export function clearAllMapContent(): void {
  removeCityMarkers();
  removeOverlayMarkers();
  clearAllOverlays();
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
  const mapStore = useMapStore();
  mapStore.currentCityOverlays = [];
  mapStore.clearSelectedCity();
}
