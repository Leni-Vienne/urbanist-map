import { useContributionStore } from "@/stores/contributionStore";
import { useMapSessionStore } from "@/stores/mapSessionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useSubmissionStore } from "@/stores/submissionStore";

import { trpc } from "@/client";

import { t } from "@/locales";
import { toastSuccess, toastError } from "@/services/core/toast";

export function removeOverlayFromState(overlayId: string) {
  const overlayStore = useOverlayStore();

  // Close selected detail before removing the overlay it reads from live store state.
  if (useFocusStore().selectedOverlayId === overlayId) {
    useFocusStore().setSelectionTarget(null);
  }

  overlayStore.removeOverlay(overlayId);

  useMapSessionStore().removeMapSessionOverlay(overlayId);
}

function removeProject(projectId: string) {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.projectId === projectId) removeOverlayFromState(overlay.id);
  }

  projectStore.removeProject(projectId);
  const submissionStore = useSubmissionStore();
  submissionStore.clearStagedRender(projectId);
  if (submissionStore.pendingSubmission?.projectId === projectId)
    submissionStore.clearPendingSubmission();
}

/**
 * Safe to call from toolbar handlers (outside Vue context).
 * Returns true if deletion was successful.
 */
export async function deleteOverlayDirect(
  overlayId: string,
  options: { showToast?: boolean } = {},
): Promise<boolean> {
  if (useSubmissionStore().isSubmitting) return false;
  const { showToast = false } = options;

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

    removeOverlayFromState(overlayId);
    if (existsInBackend) await useContributionStore().refresh();

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
  if (useSubmissionStore().isSubmitting) return false;
  const { showToast = false } = options;

  const projectStore = useProjectStore();
  const project = projectStore.projects[projectId];
  // Local-only projects were never submitted, so there is nothing to delete in the backend.
  const isLocalOnly = project?.status === null;

  try {
    if (!isLocalOnly) {
      await trpc.project.deleteProject.mutate({ id: projectId });
    }

    removeProject(projectId);
    if (!isLocalOnly) await useContributionStore().refresh();

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

  return deleteOverlayDirect(overlayId, { showToast: true });
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
    useFocusStore().setSelectionTarget(null);
  }
  return true;
}
