import { computed } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { withErrorHandling } from "@/composables/core/useErrorHandling";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { removeOverlayFromMap } from "@/composables/overlay/useOverlayRemoval";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
} from "@/composables/map/useStandaloneProjectMarkers";
import { map } from "@/composables/core/useMap";

/**
 * AI : Shared function to clean up overlay from stores and map
 */
function cleanupOverlayFromState(
  overlayId: string,
  options: {
    updateUserContributions?: boolean;
    clearCaches?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();

  // AI : Find the project that contains this overlay and remove the overlay ID from it
  const allProjectsData = projectStore.allProjects;
  const projectWithOverlay = Object.values(allProjectsData).find((p) =>
    p.overlayIds?.includes(overlayId),
  );

  if (projectWithOverlay) {
    // AI : Remove overlay ID from project's overlayIds array
    const updatedOverlayIds = projectWithOverlay.overlayIds.filter((id) => id !== overlayId);
    projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds });

    // AI : If this was the last overlay, add standalone marker back
    const isLastOverlay = updatedOverlayIds.length === 0;
    if (isLastOverlay && projectWithOverlay.lat && projectWithOverlay.lng) {
      setTimeout(() => {
        addStandaloneProjectMarkerForProject(projectWithOverlay);
      }, 150);
    }
  }

  // AI : Remove from user contributions if requested
  if (options.updateUserContributions) {
    projectStore.removeOverlayFromUserContributions(overlayId, authStore.user?.id);
  }

  // AI : Remove from map and overlay store
  removeOverlayFromMap(overlayId);

  // AI : Clear overlay from all overlay store caches
  overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter((o) => o.id !== overlayId);
  overlayStore.loadedEditOverlays.delete(overlayId);

  // AI : Remove standalone project marker if it exists (for overlay-only projects)
  const standaloneMarker = getStandaloneProjectMarkerByProjectId(overlayId);
  if (standaloneMarker && map.value) {
    map.value.removeLayer(standaloneMarker);
  }

  // AI : Clear city cache if requested
  if (options.clearCaches) {
    mapStore.clearCityProjectsCache();
    mapStore.clearCityStandaloneProjectsCache();
  }
}

/**
 * AI : Shared function to clean up project from stores and map
 */
function cleanupProjectFromState(
  projectId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  const project = projectStore.allProjects[projectId];

  // AI : If project has no overlays, remove its standalone marker from the map
  const hasNoOverlays = !project?.overlayIds || project.overlayIds.length === 0;
  if (hasNoOverlays) {
    const marker = getStandaloneProjectMarkerByProjectId(projectId);
    if (marker && map.value) {
      map.value.removeLayer(marker);
    }
  }

  // AI : Remove all overlays for this project from the map and caches
  if (project?.overlayIds) {
    project.overlayIds.forEach((overlayId) => {
      removeOverlayFromMap(overlayId);
      overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter(
        (o) => o.id !== overlayId,
      );
      overlayStore.loadedEditOverlays.delete(overlayId);
    });
  }

  // AI : Remove project from main project store
  if (projectStore.projects[projectId]) {
    delete projectStore.projects[projectId];
  }

  // AI : Remove from user contributions if requested
  if (options.updateUserContributions) {
    projectStore.removeProjectFromUserContributions(projectId);
  }

  // AI : Clear city caches to force reload when zooming (prevents ghost markers)
  mapStore.clearCityProjectsCache();
  mapStore.clearCityStandaloneProjectsCache();
}

/**
 * AI : Non-composable overlay deletion function that can be called from anywhere
 * AI : Does not use Vue composables, safe to call from Leaflet toolbar handlers
 */
export async function deleteOverlayDirect(overlayId: string): Promise<boolean> {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];

  try {
    // AI : Check if overlay exists in backend (has a status)
    // AI : Brand new overlays (status === null or undefined) only exist locally
    // AI : Using ?? to check for null/undefined - if status is null/undefined, existsInBackend = false
    const existsInBackend = (overlayObject?.status ?? null) !== null;

    if (existsInBackend) {
      // AI : Overlay exists in backend, call API to delete it
      const result = await withErrorHandling(
        async () => trpc.overlay.deleteOverlay.mutate({ id: overlayId }),
        { errorMessage: undefined },
      );

      const shouldCleanup = result?.success ?? !result;

      if (shouldCleanup) {
        cleanupOverlayFromState(overlayId, { clearCaches: false });
        return true;
      }

      return false;
    } else {
      // AI : Brand new overlay, only exists locally - just clean up local state
      cleanupOverlayFromState(overlayId, { clearCaches: false });
      return true;
    }
  } catch (error) {
    console.error("Failed to delete overlay:", error);
    return false;
  }
}

export function useUserContributions() {
  const projectStore = useProjectStore();
  const toast = useToast();

  const isLoading = computed(() => projectStore.userContributionsLoading);
  const projects = computed(() => projectStore.userContributions);

  async function fetchUserContributions() {
    if (projectStore.userContributionsLoaded) {
      return;
    }

    projectStore.setUserContributionsLoading(true);
    try {
      const result = await withErrorHandling(
        async () => trpc.project.getUsersContributions.query({ limit: 50 }),
        { errorMessage: "Failed to load contributions. Please refresh the page." },
      );

      if (result) {
        projectStore.setUserContributions(result.projects);
      }
    } finally {
      projectStore.setUserContributionsLoading(false);
    }
  }

  async function deleteOverlay(overlayId: string): Promise<boolean> {
    const overlayStore = useOverlayStore();
    const overlayObject = overlayStore.overlays[overlayId];

    try {
      // AI : Check if overlay exists in backend (has a status)
      // AI : Brand new overlays (status === null or undefined) only exist locally
      // AI : Using ?? to check for null/undefined - if status is null/undefined, existsInBackend = false
      const existsInBackend = (overlayObject?.status ?? null) !== null;

      if (existsInBackend) {
        // AI : Overlay exists in backend, call API to delete it
        const result = await withErrorHandling(
          async () => trpc.overlay.deleteOverlay.mutate({ id: overlayId }),
          { errorMessage: undefined },
        );

        // AI : Whether backend succeeded or failed, clean up local state
        const shouldCleanup = result?.success ?? !result;

        if (shouldCleanup) {
          cleanupOverlayFromState(overlayId, {
            updateUserContributions: true,
            clearCaches: true,
          });

          toast.add({
            severity: "success",
            summary: t("contributions.overlayDeleted"),
            life: 3000,
          });
          return true;
        }
        return false;
      } else {
        // AI : Brand new overlay, only exists locally - just clean up local state
        cleanupOverlayFromState(overlayId, {
          updateUserContributions: true,
          clearCaches: true,
        });

        toast.add({
          severity: "success",
          summary: t("contributions.overlayDeleted"),
          life: 3000,
        });
        return true;
      }
    } catch (error) {
      console.error("Error deleting overlay:", error);
      return false;
    }
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    try {
      // AI : Get project to check if it's local-only (not submitted to backend)
      const project = projectStore.allProjects[projectId];
      const isLocalOnly = project?.status === null;

      // AI : For local-only projects, skip backend call and just remove from local state
      if (isLocalOnly) {
        cleanupProjectFromState(projectId, { updateUserContributions: false });

        toast.add({
          severity: "success",
          summary: t("contributions.projectDeleted"),
          life: 3000,
        });
        return true;
      }

      // AI : For backend projects, call the API
      const result = await withErrorHandling(
        async () => trpc.project.deleteProject.mutate({ id: projectId }),
        { errorMessage: t("contributions.deleteProjectError") },
      );

      if (result?.success) {
        cleanupProjectFromState(projectId, { updateUserContributions: true });

        toast.add({
          severity: "success",
          summary: t("contributions.projectDeleted"),
          life: 3000,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting project:", error);
      return false;
    }
  }

  return {
    isLoading,
    projects,
    fetchUserContributions,
    deleteOverlay,
    deleteProject,
  };
}
