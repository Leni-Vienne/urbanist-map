// Country data loading service (no marker rendering)
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

// Type guard to validate country code against countryBboxes keys
export function isValidCountryCode(code: string): code is keyof typeof countryBboxes {
  return code in countryBboxes;
}

export interface CountryInfo {
  code: string;
  name: string;
}

/**
 * Helper to get country name from country code
 */
export function getCountryName(
  countryCode: string | null | undefined,
  countries: CountryInfo[],
): string | null {
  if (!countryCode) return null;
  const country = countries.find((c) => c.code === countryCode);
  return country?.name ?? null;
}

/**
 * Load countries with projects from backend
 * This loads country data for breadcrumbs and navigation (no markers rendered)
 */
export async function loadCountriesWithProjects(force = false): Promise<void> {
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  // Check if we have cached countries for this mode
  if (!force && projectStore.hasCachedCountries(mapStore.mode)) {
    // Use cached countries and update the active countries ref
    const cachedCountries = projectStore.getCachedCountries(mapStore.mode);
    if (cachedCountries) {
      projectStore.countries = cachedCountries;
      return;
    }
  }

  // For unauthenticated users, ensure we always use 'view' mode
  const authStore = useAuthStore();
  const queryMode = authStore.isAuthenticated ? mapStore.mode : "view";

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
          code2: country.code2, // Temporary default until GeoNames import populates alpha-2 codes
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    );

    // Update both the active countries ref and cache
    projectStore.countries = mappedCountries;
    projectStore.setCachedCountries(mapStore.mode, mappedCountries);
  }
}

/**
 * Load cities for a specific country
 */
export async function loadCitiesForCountry(countryCode: string): Promise<void> {
  const projectStore = useProjectStore();
  const country = projectStore.countries.find((c: Country) => c.code === countryCode);

  if (!country) return;

  const mapStore = useMapStore();
  const authStore = useAuthStore();
  const queryMode = authStore.isAuthenticated ? mapStore.mode : "view";

  // Check per-country cache first
  if (projectStore.hasCachedCities(countryCode, queryMode)) {
    const cachedCities = projectStore.getCachedCities(countryCode, queryMode);
    if (cachedCities) {
      country.cities = cachedCities;
      return;
    }
  }

  // OPTIMIZATION: Check global cities cache before making API call
  // This prevents duplicate getCitiesWithProjects calls when global cities are already loaded
  const globalCities = await projectStore.fetchCitiesWithProjects(queryMode);
  if (globalCities.length > 0) {
    const countryCities = globalCities
      .filter((city) => city.countryCode === countryCode)
      .map((city) => Object.assign({}, city, { distance: 0 }));

    if (countryCities.length > 0) {
      country.cities = countryCities;
      // Cache the filtered cities for this country + mode
      projectStore.setCachedCities(countryCode, queryMode, countryCities);
      return;
    }
  }

  // Fallback: If no cities found in global cache, make country-specific API call
  // This handles edge cases where global cache might be incomplete
  const citiesData = await withErrorHandling(
    async () => trpc.cities.getCitiesWithProjects.query({ countryCode, mode: queryMode }),
    { errorMessage: "Failed to load cities. Please try again." },
  );

  if (citiesData) {
    const cities = citiesData.map((city) => {
      return Object.assign({}, city, { distance: 0 });
    });
    country.cities = cities;
    // Cache the cities for this country + mode
    projectStore.setCachedCities(countryCode, queryMode, cities);
  }
}

/**
 * Clear all map content (markers, overlays, cache, and state)
 * This is called when switching between countries or logging out
 */
export function clearAllMapContent(): void {
  clearAllOverlays();
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
  const mapStore = useMapStore();
  mapStore.currentCityOverlays = [];
  mapStore.clearSelectedCity();
}
