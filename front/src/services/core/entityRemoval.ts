// AI : Unified entity removal service
// AI : Centralizes logic for removing projects and overlays from stores, map, and caches
// AI : Extracted from composables to separate business logic from Vue context

import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { map } from "@/services/core/map";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
} from "@/services/map/standaloneProjectMarkers";
import { trpc } from "@/client";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";

// AI : Options for deleteOverlayDirect, allowing callers to customize behavior
interface DeleteOverlayOptions {
  showToast?: boolean;
  updateUserContributions?: boolean;
  clearCityCaches?: boolean;
}

/**
 * AI : Remove overlay from map layers and overlay store
 */
export function removeOverlayFromMapAndStore(overlayId: string) {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  // AI : Remove visual elements
  if (overlayObject.overlay) {
    if (map.value.hasLayer(overlayObject.overlay)) {
      map.value.removeLayer(overlayObject.overlay);
    }
  }

  if (overlayObject.marker) {
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
  if (marker && map.value.hasLayer(marker)) {
    map.value.removeLayer(marker);
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
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const authStore = useAuthStore();

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
export function removeProject(
  projectId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();

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

/**
 * AI : Non-composable overlay deletion function that can be called from anywhere
 * AI : Safe to call from Leaflet toolbar handlers
 * AI : Returns true if deletion was successful
 */
export async function deleteOverlayDirect(
  overlayId: string,
  options: DeleteOverlayOptions = {},
): Promise<boolean> {
  const { showToast = false, updateUserContributions = false, clearCityCaches = false } = options;

  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];

  try {
    // AI : Check if overlay exists in backend (has a status)
    // AI : Brand new overlays (status === null or undefined) only exist locally
    // AI : Using ?? to check for null/undefined - if status is null/undefined, existsInBackend = false
    const existsInBackend = (overlayObject?.status ?? null) !== null;

    if (existsInBackend) {
      // AI : Overlay exists in backend, call API to delete it
      // AI : If it throws, the outer catch handles it and returns false
      await trpc.overlay.deleteOverlay.mutate({ id: overlayId });
    }

    removeOverlay(overlayId, { updateUserContributions, clearCityCaches });

    if (showToast) {
      const toast = useToast();
      toast.add({
        severity: "success",
        summary: t("contribute.overlayDeleted"),
        life: 3000,
      });
    }
    return true;
  } catch (error) {
    console.error("Failed to delete overlay:", error);
    return false;
  }
}
