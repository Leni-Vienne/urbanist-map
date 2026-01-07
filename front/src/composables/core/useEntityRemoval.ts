import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/composables/core/useMap";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
} from "@/composables/map/useStandaloneProjectMarkers";

/**
 * AI : Unified entity removal composable
 * AI : Centralizes logic for removing projects and overlays from stores, map, and caches
 */
export function useEntityRemoval() {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();

  /**
   * AI : Remove overlay from map layers and overlay store
   */
  function removeOverlayFromMapAndStore(overlayId: string) {
    const overlayObject = overlayStore.overlays[overlayId];
    if (!overlayObject) return;

    // AI : Remove visual elements
    if (overlayObject.overlay && map.value) {
      if (map.value.hasLayer(overlayObject.overlay)) {
        map.value.removeLayer(overlayObject.overlay);
      }
    }

    if (overlayObject.marker && map.value) {
      if (map.value.hasLayer(overlayObject.marker)) {
        map.value.removeLayer(overlayObject.marker);
      }
    }

    // AI : Remove from store
    delete overlayStore.overlays[overlayId];
    delete overlayStore.allMarkers[overlayId];

    // AI : Clear specific caches
    overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter((o) => o.id !== overlayId);
    overlayStore.loadedEditOverlays.delete(overlayId);

    // AI : Reset selection if needed
    if (overlayStore.idSelectedOverlay === overlayId) {
      overlayStore.idSelectedOverlay = null;
    }
  }

  /**
   * AI : Remove project standalone marker from map
   */
  function removeProjectMarkerFromMap(projectId: string) {
    const marker = getStandaloneProjectMarkerByProjectId(projectId);
    if (marker && map.value) {
      if (map.value.hasLayer(marker)) {
        map.value.removeLayer(marker);
      }
    }
  }

  /**
   * AI : Comprehensive overlay removal
   * AI : Handles Store, Map, Cache, Project Association, and Standalone Marker restoration
   */
  function removeOverlay(
    overlayId: string,
    options: {
      updateUserContributions?: boolean;
      clearCityCaches?: boolean;
    } = {},
  ) {
    // AI : 1. Find parent project to update its overlay list
    const allProjectsData = projectStore.allProjects;
    // AI : Find project by overlayIds array (most reliable source)
    const projectWithOverlay = Object.values(allProjectsData).find((p) =>
      p.overlayIds?.includes(overlayId),
    );

    if (projectWithOverlay) {
      // AI : Update project overlay list
      const updatedOverlayIds = projectWithOverlay.overlayIds.filter((id) => id !== overlayId);
      projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds });

      // AI : 2. Restore standalone marker if this was the last overlay
      const isLastOverlay = updatedOverlayIds.length === 0;
      if (isLastOverlay && projectWithOverlay.lat && projectWithOverlay.lng) {
        // AI : Small delay ensures map is ready after removal animations
        setTimeout(() => {
          addStandaloneProjectMarkerForProject(projectWithOverlay);
        }, 150);
      }
    }

    // AI : 3. Remove native map layers and store entries
    removeOverlayFromMapAndStore(overlayId);

    // AI : 4. Update interactions with other stores
    if (options.updateUserContributions) {
      projectStore.removeOverlayFromUserContributions(overlayId, authStore.user?.id);
    }

    if (options.clearCityCaches) {
      mapStore.clearCityProjectsCache();
      mapStore.clearCityStandaloneProjectsCache();
    }

    // AI : Also remove standalone marker for this specific overlay ID (legacy/edge case support)
    removeProjectMarkerFromMap(overlayId);
  }

  /**
   * AI : Comprehensive project removal
   * AI : Removes project and all its associated overlays
   */
  function removeProject(
    projectId: string,
    options: {
      updateUserContributions?: boolean;
    } = {},
  ) {
    const project = projectStore.allProjects[projectId];

    // AI : 1. Clean up standalone project marker
    const hasNoOverlays = !project?.overlayIds || project.overlayIds.length === 0;
    if (hasNoOverlays) {
      removeProjectMarkerFromMap(projectId);
    }

    // AI : 2. Remove all associated overlays
    if (project?.overlayIds) {
      for (const overlayId of project.overlayIds) {
        removeOverlayFromMapAndStore(overlayId);
      }
    }

    // AI : 3. Remove project from store
    if (projectStore.projects[projectId]) {
      delete projectStore.projects[projectId];
    }

    // AI : 4. Update auxiliary stores
    if (options.updateUserContributions) {
      projectStore.removeProjectFromUserContributions(projectId);
    }

    // AI : 5. Force cache clear to prevent ghost data
    mapStore.clearCityProjectsCache();
    mapStore.clearCityStandaloneProjectsCache();
  }

  return {
    removeOverlay,
    removeProject,
    // AI : Expose lower level if needed, but prefer high level functions
    removeOverlayFromMapAndStore,
  };
}
