import { ref, watch } from "vue";
import {
  mobileAwareFlyTo,
  mobileAwareFlyToBounds,
  calculateBoundsFromLocations,
} from "@/services/map/mapNavigation";
import { loadAndRenderCityData } from "@/services/navigation/cityNavigationTriggers";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { map } from "@/services/core/map";

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
 * Smart zoom logic: Fit bounds of all content (center + projects + overlays)
 */
function smartZoomToCity(
  city: { lat: number; lng: number },
  data: {
    overlays: { corners?: { lat: number; lng: number }[] | null }[];
    projects: { lat: number | null; lng: number | null }[];
  },
) {
  const { overlays, projects } = data;

  // Collect all content locations for bounds calculation
  // Projects have nullable lat/lng (standalone projects may lack coordinates)
  const locations: { lat: number; lng: number }[] = [
    { lat: city.lat, lng: city.lng },
    ...projects
      .filter((p): p is typeof p & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
      .map((p) => ({ lat: p.lat, lng: p.lng })),
    ...overlays.flatMap((o) => (Array.isArray(o.corners) ? o.corners : [])),
  ];

  const hasContent = projects.length > 0 || overlays.length > 0;

  if (hasContent) {
    // Fit to bounds of all content
    const bounds = calculateBoundsFromLocations(locations);
    mobileAwareFlyToBounds(bounds!, {
      animate: true,
      duration: 1.5,
      maxZoom: 15,
      padding: [50, 50],
    });
  } else if (map.value.getZoom() < 14) {
    // Empty city below threshold: zoom in to a readable level
    mobileAwareFlyTo([city.lat, city.lng], 14, { duration: 1.5 });
  } else {
    // Empty city already zoomed in: pan only
    mobileAwareFlyTo([city.lat, city.lng], map.value.getZoom(), { duration: 0.5 });
  }
}

/**
 * Activate a city (select, load data, and smart zoom)
 * Called by cluster source click handlers and panel navigation
 */
export async function activateCity(city: CityWithProjects) {
  const mapStore = useMapStore();

  mapStore.setSelectedCity({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode,
  });

  // Load city data before flight animation
  // Leaflet event handlers have no composable layer above them, so errors must be caught here
  try {
    const result = await loadAndRenderCityData(city.id, true);
    smartZoomToCity(city, result);
  } catch (error) {
    console.error(`Failed to load data for city ${city.id}:`, error);
    // Still zoom to city center so the map stays usable even if data loading failed
    smartZoomToCity(city, { overlays: [], projects: [] });
  }
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
