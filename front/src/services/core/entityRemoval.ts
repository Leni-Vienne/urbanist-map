// Removes projects and overlays from stores, map layers, and caches

import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { clearEntry as clearRegistryEntry } from "@/services/overlay/renderRegistry";
import { selectOverlay } from "@/services/overlay/selection";
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

  // Deselect before deleting from the store: selectOverlay(null) owns the full cleanup
  // (edit handles, project highlight, docked detail) and needs the overlay still present.
  if (overlayStore.idSelectedOverlay === overlayId) {
    selectOverlay(null);
  }

  clearRegistryEntry(overlayId);

  delete overlayStore.overlays[overlayId];

  overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter((o) => o.id !== overlayId);

  // Prevents stale entries in the submission dialog
  usePendingModificationsStore().clearModification(overlayId);
}

function removeProjectMarkerFromMap(projectId: string) {
  getStandaloneProjectMarkerByProjectId(projectId)?.remove();
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
    if (
      isLastOverlay &&
      typeof projectWithOverlay.lat === "number" &&
      typeof projectWithOverlay.lng === "number"
    ) {
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
 * Safe to call from toolbar handlers (outside Vue context).
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
    // Brand new overlays (status null) only exist locally, and always live in the store.
    // An overlay missing from the store is therefore a persisted backend overlay (e.g.
    // renders, which are never loaded into the overlay store), so it must be deleted in the backend.
    const existsInBackend = overlayObject ? overlayObject.status !== null : true;

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
