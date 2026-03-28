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
}
