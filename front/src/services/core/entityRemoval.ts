// Removes projects and overlays from stores, map layers, and caches

import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { legacyLeafletMap } from "@/lib/legacyLeafletMap";
import { clearEntry as clearRegistryEntry } from "@/services/overlay/overlayRenderRegistry";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
} from "@/services/map/standaloneProjectMarkers";
import { trpc } from "@/client";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";

interface DeleteOverlayOptions {
  showToast?: boolean;
  updateUserContributions?: boolean;
}

export function removeOverlayFromMapAndStore(overlayId: string) {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  clearRegistryEntry(overlayId);

  delete overlayStore.overlays[overlayId];

  overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter((o) => o.id !== overlayId);

  if (overlayStore.idSelectedOverlay === overlayId) {
    overlayStore.idSelectedOverlay = null;
  }

  // Prevents stale entries in the submission dialog
  usePendingModificationsStore().clearModification(overlayId);
}

function removeProjectMarkerFromMap(projectId: string) {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (marker && legacyLeafletMap().hasLayer(marker)) {
    legacyLeafletMap().removeLayer(marker);
  }
}

function removeOverlay(
  overlayId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  const allProjectsData = projectStore.projects;
  const projectWithOverlay = Object.values(allProjectsData).find((p) =>
    p.overlayIds.includes(overlayId),
  );

  if (projectWithOverlay) {
    const updatedOverlayIds = projectWithOverlay.overlayIds.filter((id) => id !== overlayId);
    projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds });

    const isLastOverlay = updatedOverlayIds.length === 0;
    if (isLastOverlay && projectWithOverlay.lat && projectWithOverlay.lng) {
      // Small delay ensures map is ready after removal animations
      setTimeout(() => {
        addStandaloneProjectMarkerForProject(projectWithOverlay);
      }, 150);
    }
  }

  removeOverlayFromMapAndStore(overlayId);

  if (options.updateUserContributions) {
    projectStore.removeOverlayFromUserContributions(overlayId, authStore.user?.id);
  }

  removeProjectMarkerFromMap(overlayId);
}

export function removeProject(
  projectId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();

  const project = projectStore.projects[projectId];

  const hasNoOverlays = !project?.overlayIds || project.overlayIds.length === 0;
  if (hasNoOverlays) {
    removeProjectMarkerFromMap(projectId);
  }

  if (project?.overlayIds) {
    for (const overlayId of project.overlayIds) {
      removeOverlayFromMapAndStore(overlayId);
    }
  }

  if (projectStore.projects[projectId]) {
    delete projectStore.projects[projectId];
  }

  if (options.updateUserContributions) {
    projectStore.removeProjectFromUserContributions(projectId);
  }
}

/**
 * Safe to call from Leaflet toolbar handlers (outside Vue context).
 * Returns true if deletion was successful.
 */
export async function deleteOverlayDirect(
  overlayId: string,
  options: DeleteOverlayOptions = {},
): Promise<boolean> {
  const { showToast = false, updateUserContributions = false } = options;

  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];

  try {
    // Brand new overlays (status null/undefined) only exist locally
    const existsInBackend = (overlayObject?.status ?? null) !== null;

    if (existsInBackend) {
      await trpc.overlay.deleteOverlay.mutate({ id: overlayId });
    }

    removeOverlay(overlayId, { updateUserContributions });

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
