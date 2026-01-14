// AI : City data loading for navigation - extracted to break circular dependency
// AI : Used by both useCityMarkers.ts and useViewportContentManager.ts
import { ref } from "vue";
import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { trpc } from "@/client";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlay";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import {
  renderOverlayMarkersFromData,
  removeOverlayMarkers,
} from "@/composables/map/useCityOverlays";
import { addStandaloneProjectMarkerForProject } from "@/composables/map/useStandaloneProjectMarkers";
import type { OverlayData } from "@/types/index";
import {
  createProjectObject,
  toProjectPartial,
  type CityProject,
  type StandaloneProject,
} from "@/utils/typeFactories";
import type { MapMode } from "@shared/types";

/**
 * AI : Module-level ref to track loaded cities across both viewport manager and direct navigation
 * AI : Shared state prevents duplicate loads and enables cache checking
 * AI : Wrapped in Vue ref for reactivity and compatibility with existing code
 */
export const loadedCityIds = ref<Set<number>>(new Set());

/**
 * AI : Helper to fetch city overlays from cache or backend
 */
async function fetchCityOverlaysOrCache(
  cityId: number,
  mode: MapMode,
): Promise<OverlayData[] | null> {
  const mapStore = useMapStore();
  let overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, mode);

  if (!overlaysData) {
    overlaysData = await trpc.cities.getCityOverlaysAndProjects.query({
      cityId,
      mode,
    });
    if (overlaysData) {
      mapStore.setCityProjectsCache(cityId, mode, overlaysData);
    }
  }
  return overlaysData;
}

/**
 * AI : Helper to fetch standalone projects from cache or backend
 */
async function fetchCityStandaloneProjectsOrCache(
  cityId: number,
  mode: MapMode,
): Promise<CityProject[] | null> {
  const mapStore = useMapStore();
  let standaloneProjects = mapStore.getCityStandaloneProjectsCache(cityId, mode);

  if (!standaloneProjects) {
    standaloneProjects = await trpc.project.getCityProjects.query({
      cityId,
      mode,
      limit: 100,
    });
    if (standaloneProjects) {
      mapStore.setCityStandaloneProjectsCache(cityId, mode, standaloneProjects);
    }
  }
  return standaloneProjects;
}

/**
 * AI : Add markers for standalone projects (those without overlays)
 */
function processStandaloneMarkers(
  standaloneProjects: StandaloneProject[],
  overlaysData: OverlayData[] | null,
) {
  if (!standaloneProjects || standaloneProjects.length === 0) return;

  const projectIdsWithOverlays = new Set<string>();
  if (overlaysData) {
    for (const overlay of overlaysData) {
      // AI : Check safely if projectId exists
      if (overlay.projectId) {
        projectIdsWithOverlays.add(overlay.projectId);
      }
    }
  }

  for (const project of standaloneProjects) {
    // AI : Safe access to overlay count/ids using type narrowing
    let overlayCount = 0;
    if ("overlayCount" in project) {
      overlayCount = project.overlayCount;
    } else if ("overlayIds" in project && Array.isArray(project.overlayIds)) {
      overlayCount = project.overlayIds.length;
    }

    if (!projectIdsWithOverlays.has(project.id) && overlayCount === 0) {
      // AI : Cast to Project to satisfy function signature - strictly validation would require more fields
      // AI : but for marker creation, the subset in CityProject is sufficient
      addStandaloneProjectMarkerForProject(createProjectObject(toProjectPartial(project)));
    }
  }
}

/**
 * AI : Render Logic for Navigation
 */
function renderCityOverlaysForNavigation(overlaysData: OverlayData[], forceFullOverlays: boolean) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  const zoom = map.value?.getZoom() ?? 0;
  const shouldRenderFullOverlays = forceFullOverlays || zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

  removeOverlayMarkers();
  overlayStore.setViewModeOverlays(overlaysData);
  mapStore.currentCityOverlays = overlaysData;

  if (shouldRenderFullOverlays) {
    const existingIds = new Set(Object.keys(overlayStore.overlays));
    if (existingIds.size === 0) {
      renderViewModeOverlays(overlaysData, true, false);
    } else {
      const newOverlays = overlaysData.filter((o) => !existingIds.has(o.id));
      if (newOverlays.length > 0) {
        renderViewModeOverlays(newOverlays, true, false);
      }
    }
  } else {
    clearAllOverlays();
    renderOverlayMarkersFromData(overlaysData);
  }
}

/**
 * AI : Standalone function for navigation to load city data
 * AI : Uses helpers to orchestrate loading and rendering
 * AI : Extracted to separate file to break circular dependency between useCityMarkers and useViewportContentManager
 */
export async function loadCityDataForNavigation(
  cityId: number,
  forceFullOverlays = false,
): Promise<OverlayData[] | null> {
  const overlayStore = useOverlayStore();
  const mode = overlayStore.mode;

  try {
    const overlaysData = await fetchCityOverlaysOrCache(cityId, mode);
    let standaloneProjects: StandaloneProject[] | null = await fetchCityStandaloneProjectsOrCache(
      cityId,
      mode,
    );

    // AI : CRITICAL FIX: In edit mode, include local projects from projectStore
    // AI : This ensures newly created project markers persist when zooming out and back in
    if (mode === "edit" && standaloneProjects) {
      const { useProjectStore } = await import("@/stores/pinia/projectStore");
      const { useAuthStore } = await import("@/stores/authStore");
      const projectStore = useProjectStore();
      const authStore = useAuthStore();

      // AI : Filter for local and user's pending projects for this specific city
      const localProjects = Object.values(projectStore.projects).filter((p) => {
        if (p.cityId !== cityId) return false;
        if (!p.lat || !p.lng) return false;

        // AI : Local projects (not yet submitted)
        if (p.status === null || p.status === undefined) return true;

        // AI : User's own pending projects (submitted but not approved)
        if (p.status === "pending" && authStore.user && p.ownerId === authStore.user.id)
          return true;

        return false;
      });

      // AI : Merge local projects with backend projects (avoid duplicates)
      const existingIds = new Set(standaloneProjects.map((p) => p.id));
      const mergedProjects: StandaloneProject[] = [...standaloneProjects];
      for (const localProject of localProjects) {
        if (!existingIds.has(localProject.id)) {
          // AI : Cast as StandaloneProject (Project is compatible with the union type)
          mergedProjects.push(localProject as StandaloneProject);
        }
      }
      standaloneProjects = mergedProjects;
    }

    processStandaloneMarkers(standaloneProjects ?? [], overlaysData);

    loadedCityIds.value.add(cityId);

    if (!overlaysData || overlaysData.length === 0) {
      return null;
    }

    renderCityOverlaysForNavigation(overlaysData, forceFullOverlays);

    return overlaysData;
  } catch (error) {
    console.error(`Error loading city ${cityId} for navigation:`, error);
    return null;
  }
}
