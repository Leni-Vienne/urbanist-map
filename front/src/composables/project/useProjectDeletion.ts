import { t } from "@/locales";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { useFocusStore } from "@/stores/pinia/focusStore";

export function useProjectDeletion() {
  const { deleteOverlay, deleteProject } = useUserContributions();
  const focusStore = useFocusStore();

  /**
   * Delete an overlay with confirmation.
   */
  async function handleDeleteOverlay(
    overlayId: string,
    overlayName: string | null,
    onSuccess?: () => void,
  ): Promise<boolean> {
    const confirmMessage = t("common.confirmDelete", {
      name: overlayName ?? t("overlay.untitled"),
    });
    if (!confirm(confirmMessage)) return false;

    const success = await deleteOverlay(overlayId);
    if (!success) return false;

    onSuccess?.();
    return true;
  }

  /**
   * Delete a project with confirmation
   */
  async function handleDeleteProject(
    projectId: string,
    projectName: string | null,
    overlayCount: number,
    onSuccess?: () => void,
  ): Promise<boolean> {
    const confirmMessage =
      overlayCount > 0
        ? t("contribute.confirmDeleteProjectWithOverlays", {
            name: projectName,
            count: overlayCount,
          })
        : t("common.confirmDelete", { name: projectName });

    if (!confirm(confirmMessage)) return false;

    const success = await deleteProject(projectId);
    if (!success) return false;

    if (focusStore.selectedProjectId === projectId) {
      focusStore.clearSelection();
    }

    onSuccess?.();
    return true;
  }

  return {
    handleDeleteOverlay,
    handleDeleteProject,
  };
}
