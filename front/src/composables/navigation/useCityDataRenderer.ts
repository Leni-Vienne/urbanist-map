// AI : City data rendering helpers for navigation
// AI : Separated from data loading to avoid circular dependencies

import { map } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlayRendering";
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
  type StandaloneProject,
} from "@/utils/typeFactories";
import { loadCityData } from "@/composables/navigation/useCityDataLoader";

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
      addStandaloneProjectMarkerForProject(createProjectObject(toProjectPartial(project)));
    }
  }
}

/**
 * AI : Render city overlays for navigation
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
 * AI : Load and render city data for navigation
 * AI : This combines data loading (from useCityDataLoader) with rendering
 * AI : Used by city marker clicks and navigation flows
 */
export async function loadAndRenderCityData(
  cityId: number,
  forceFullOverlays = false,
): Promise<OverlayData[] | null> {
  try {
    const result = await loadCityData(cityId);
    if (!result) return null;

    const { overlays, projects } = result;

    // AI : Process standalone markers
    if (projects) {
      processStandaloneMarkers(projects, overlays);
    }

    // AI : Render overlays if any exist
    if (overlays && overlays.length > 0) {
      renderCityOverlaysForNavigation(overlays, forceFullOverlays);
      return overlays;
    }

    return null;
  } catch (error) {
    console.error(`Error loading and rendering city ${cityId}:`, error);
    return null;
  }
}
