import { ref, watch } from "vue";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";

// Type aliases using RouterOutput from tRPC
type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// Cities with projects data — used by panels (CurrentLocationPanel, PopupContainer, MarkerHelpButton)
export const citiesWithProjects = ref<CityWithProjects[]>([]);

/**
 * Build the list of cities to display for the current mode.
 * View mode is always the base (approved content); edit/moderation modes add their own cities on top.
 */
async function buildCitiesForCurrentMode(): Promise<CityWithProjects[]> {
  const mapStore = useMapStore();
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  // Unauthenticated users always see view mode regardless of store state
  const currentMode = authStore.isAuthenticated ? mapStore.mode : "view";

  if (currentMode === "view") {
    return projectStore.fetchCitiesWithProjects("view");
  }

  if (currentMode === "moderation") {
    // Moderation mode: only show cities that have pending items — no approved-only cities
    return projectStore.fetchCitiesWithProjects("moderation");
  }

  // Edit mode: additive — approved cities + user's own pending cities
  const viewCities = await projectStore.fetchCitiesWithProjects("view");
  const editCities = await projectStore.fetchCitiesWithProjects("edit");
  const viewCityIds = new Set(viewCities.map((c) => c.id));
  const additionalCities = editCities.filter((c) => !viewCityIds.has(c.id));
  const mergedCities = [...viewCities, ...additionalCities];
  return projectStore.getMergedCities(mergedCities, authStore.user?.id ?? null);
}

/**
 * Fetch cities for the current mode and keep citiesWithProjects reactive ref updated.
 * Sets up a mode watcher so panels always reflect the current mode's cities.
 * Returns the initial cities list (for mapStore.citiesLookup population).
 *
 * Replaces loadAllCityMarkersGlobally — no Leaflet marker creation.
 */
export async function initializeCitiesData(): Promise<CityWithProjects[]> {
  const citiesData = await buildCitiesForCurrentMode();
  citiesWithProjects.value = citiesData;

  // Watch for mode changes and refresh the cities list for panels
  const mapStore = useMapStore();
  watch(
    () => mapStore.mode,
    async (newMode, oldMode) => {
      if (newMode === oldMode) return;
      try {
        const cities = await buildCitiesForCurrentMode();
        citiesWithProjects.value = cities;
      } catch (error) {
        console.error("Error reloading cities list on mode change:", error);
      }
    },
  );

  return citiesData;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
