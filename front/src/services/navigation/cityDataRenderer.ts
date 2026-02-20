// AI : City data rendering helpers for navigation
// AI : Separated from data loading to avoid circular dependencies

import { map } from "@/services/core/map";
import { ref } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { renderOverlayMarkersFromData, removeOverlayMarkers } from "@/services/map/cityOverlays";
import { addStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import type { OverlayData } from "@/types/index";
import {
  createProjectObject,
  toProjectPartial,
  type StandaloneProject,
} from "@/utils/typeFactories";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { loadCityData } from "@/services/navigation/cityDataLoader";
import { pruneMapEntities } from "@/services/map/viewportPruning";

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

  const zoom = map.value.getZoom();
  const shouldRenderFullOverlays = forceFullOverlays || zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

  removeOverlayMarkers();
  overlayStore.setViewModeOverlays(overlaysData);

  mapStore.currentCityOverlays = overlaysData;

  // AI : Update existing overlay objects with fresh backend data (e.g. hasPendingChanges)
  // AI : This is critical when switching from View -> Edit mode where overlays already exist
  // AI : but need to be updated with edit-mode specific data
  for (const overlayData of overlaysData) {
    const existing = overlayStore.overlays[overlayData.id];
    if (existing) {
      overlayStore.updateOverlay(overlayData.id, {
        hasPendingChanges: overlayData.hasPendingChanges,
        suggestedCorners: overlayData.suggestedCorners,
        pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
      });
    }
  }

  // AI : Explicitly update marker colors after data refresh to ensure they reflect new state
  // AI : (e.g. turning yellow if hasPendingChanges is now true)
  // AI : We do this BEFORE rendering new overlays to ensure consistent state
  updateOverlayMarkersColors(ref(overlayStore.overlays), overlayStore.mode);

  if (shouldRenderFullOverlays) {
    // AI : Do NOT render all overlays immediately (prevents GPU crash)
    // AI : Just ensure they are in the store (done above by setViewModeOverlays)
    // AI : allowing the ViewportPruning to pick them up

    // AI : Import dynamically to avoid circular dependencies (cityDataRenderer -> overlayRendering -> viewportPruning? no wait)
    // AI : viewportPruning imports overlayRendering.
    // AI : So we can import viewportPruning here.
    pruneMapEntities();
  } else {
    // AI : For low zoom, we show Markers.
    // AI : Clear overlays? (removed by viewport logic if we don't call it? No, explicit clear is safer)
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
): Promise<{ overlays: OverlayData[]; projects: StandaloneProject[] } | null> {
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
    }

    // AI : Return both overlays and projects for bounds calculation
    return {
      overlays: overlays ?? [],
      projects: projects ?? [],
    };
  } catch (error) {
    console.error(`Error loading and rendering city ${cityId}:`, error);
    return null;
  }
}
