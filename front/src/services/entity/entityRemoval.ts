// Removes projects and overlays from stores, map layers, and caches

import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useAuthStore } from "@/stores/authStore";
import { clearEntry as clearRegistryEntry } from "@/services/overlay/mapLayers";
import { closeDetail } from "@/services/overlay/selection";
import { trpc } from "@/client";
import { removeMapSessionOverlay } from "@/services/map/mapSessionState";

import { t } from "@/locales";
import { toastSuccess, toastError } from "@/services/core/toast";

interface DeleteOverlayOptions {
  showToast?: boolean;
  updateUserContributions?: boolean;
}

export function removeOverlayFromMapAndStore(overlayId: string) {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[overlayId];
  if (!overlayObject) return;

  // Close selected detail before removing the overlay it reads from live store state.
  if (useFocusStore().selectedOverlayId === overlayId) {
    closeDetail();
  }

  clearRegistryEntry(overlayId);

  // eslint-disable-next-line no-dynamic-delete
  delete overlayStore.liveOverlays[overlayId];

  removeMapSessionOverlay(overlayId);
}

function removeOverlay(
  overlayId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  removeOverlayFromMapAndStore(overlayId);

  if (options.updateUserContributions) {
    projectStore.removeOverlayFromUserContributions(overlayId, authStore.user?.id);
  }
}

function removeProject(
  projectId: string,
  options: {
    updateUserContributions?: boolean;
  } = {},
) {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.projectId === projectId) removeOverlayFromMapAndStore(overlay.id);
  }

  projectStore.removeProject(projectId);

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
  const overlayObject = overlayStore.liveOverlays[overlayId];

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
      toastSuccess(t("contribute.overlayDeleted"));
    }
    return true;
  } catch (error) {
    console.error("Failed to delete overlay:", error);
    if (showToast) {
      toastError(t("contribute.deleteOverlayError"));
    }
    return false;
  }
}

/**
 * Safe to call from toolbar handlers (outside Vue context).
 * Returns true if deletion was successful.
 */
async function deleteProjectDirect(
  projectId: string,
  options: { showToast?: boolean } = {},
): Promise<boolean> {
  const { showToast = false } = options;

  const projectStore = useProjectStore();
  const project = projectStore.projects[projectId];
  // Local-only projects (status null) were never submitted, so there is nothing to delete in the
  // backend and no user-contribution entry to update.
  const isLocalOnly = project?.status === null;

  try {
    if (!isLocalOnly) {
      await trpc.project.deleteProject.mutate({ id: projectId });
    }

    removeProject(projectId, { updateUserContributions: !isLocalOnly });

    if (showToast) {
      toastSuccess(t("contribute.projectDeleted"));
    }
    return true;
  } catch (error) {
    console.error("Error deleting project:", error);
    if (showToast) {
      toastError(t("contribute.deleteProjectError"));
    }
    return false;
  }
}

export async function confirmAndDeleteOverlay(
  overlayId: string,
  overlayName: string | null,
): Promise<boolean> {
  const confirmMessage = t("common.confirmDelete", {
    name: overlayName ?? t("overlay.untitled"),
  });
  if (!confirm(confirmMessage)) return false;

  return deleteOverlayDirect(overlayId, { showToast: true, updateUserContributions: true });
}

export async function confirmAndDeleteProject(
  projectId: string,
  projectName: string | null,
  overlayCount: number,
): Promise<boolean> {
  const name = projectName ?? t("project.unnamed");
  const confirmMessage =
    overlayCount > 0
      ? t("contribute.confirmDeleteProjectWithOverlays", { name, count: overlayCount })
      : t("common.confirmDelete", { name });
  if (!confirm(confirmMessage)) return false;

  const success = await deleteProjectDirect(projectId, { showToast: true });
  if (!success) return false;

  const focusStore = useFocusStore();
  if (focusStore.selectedProjectId === projectId) {
    closeDetail();
  }
  return true;
}
