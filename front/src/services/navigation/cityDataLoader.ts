// City data loading for navigation - pure data fetching only (no rendering)
// Rendering is handled by callers to avoid circular dependencies
import { ref } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { trpc } from "@/client";
import type { OverlayData } from "@/types/index";
import type { CityProject } from "@/utils/typeFactories";
import type { AppMode } from "@shared/types";

/**
 * Module-level ref to track loaded cities across both viewport manager and direct navigation
 * Shared state prevents duplicate loads and enables cache checking
 * Wrapped in Vue ref for reactivity and compatibility with existing code
 */
export const loadedCityIds = ref<Set<number>>(new Set());

/**
 * Helper to fetch city overlays from cache or backend
 */
export async function fetchCityOverlaysOrCache(
  cityId: number,
  mode: AppMode,
): Promise<OverlayData[] | null> {
  const mapStore = useMapStore();
  let overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, mode);

  if (!overlaysData) {
    overlaysData = await trpc.cities.getCityOverlaysAndProjects.query({
      cityId,
      mode,
    });
    mapStore.setCityProjectsCache(cityId, mode, overlaysData);
  }
  return overlaysData;
}

/**
 * Helper to fetch standalone projects from cache or backend
 * Exported for reuse across viewport manager and marker composables
 */
export async function fetchCityStandaloneProjectsOrCache(
  cityId: number,
  mode: AppMode,
): Promise<CityProject[] | null> {
  const mapStore = useMapStore();
  let standaloneProjects = mapStore.getCityStandaloneProjectsCache(cityId, mode);

  if (!standaloneProjects) {
    standaloneProjects = await trpc.project.getCityProjects.query({
      cityId,
      mode,
      limit: 100,
    });
    mapStore.setCityStandaloneProjectsCache(cityId, mode, standaloneProjects);
  }
  return standaloneProjects;
}

/**
 * Load city data (overlays + standalone projects) without rendering
 * Callers are responsible for rendering the data
 * Returns both overlays and standalone projects for the city
 */
export async function loadCityData(
  cityId: number,
  mode?: AppMode,
): Promise<{ overlays: OverlayData[] | null; projects: CityProject[] | null }> {
  const overlayStore = useOverlayStore();
  const actualMode = mode ?? overlayStore.mode;

  const [overlays, projects] = await Promise.all([
    fetchCityOverlaysOrCache(cityId, actualMode),
    fetchCityStandaloneProjectsOrCache(cityId, actualMode),
  ]);

  // Mark city as loaded
  loadedCityIds.value.add(cityId);

  return { overlays, projects };
}
