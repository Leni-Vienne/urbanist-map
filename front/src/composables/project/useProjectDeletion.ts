import { t } from "@/locales";
import type { Project } from "@/types/index";
import { useToast } from "@/composables/ui/useToast";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { addStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";

export function useProjectDeletion() {
  const toast = useToast();
  const { deleteOverlay, deleteProject } = useUserContributions();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();

  /**
   * AI : Delete an overlay with confirmation and auto-add standalone project marker if it's the last one
   * AI : Project parameter accepts any object with id, lat, lng for standalone project marker
   */
  async function handleDeleteOverlay(
    overlayId: string,
    project: { id: string; lat: number | null; lng: number | null } | null | undefined,
    projectOverlayCount: number,
    overlayName: string | null,
    onSuccess?: () => void,
  ): Promise<boolean> {
    const confirmMessage = t("common.confirmDelete", {
      name: overlayName ?? t("overlay.untitled"),
    });
    if (!confirm(confirmMessage)) return false;

    const isLastOverlay = projectOverlayCount === 1;

    const success = await deleteOverlay(overlayId);
    if (!success) return false;

    // AI : If it was the last overlay, add a standalone project marker to show the project
    // AI : (entityRemoval.removeOverlay also does this for backend projects; this is a safety net for local-only projects)
    if (isLastOverlay && project?.id && project.lat && project.lng) {
      // AI : Get updated project from store, or use the passed project
      const updatedProject =
        projectStore.projects[project.id] ?? projectStore.allProjects[project.id] ?? project;

      await new Promise<void>((resolve) => void setTimeout(() => resolve(), 150));
      addStandaloneProjectMarkerForProject(updatedProject as unknown as Project);
    }

    onSuccess?.();
    return true;
  }

  /**
   * AI : Delete a project with confirmation
   */
  async function handleDeleteProject(
    projectId: string,
    projectName: string,
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

    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
      uiStore.closeProjectInfoPopup();
    }

    onSuccess?.();
    return true;
  }

  return {
    handleDeleteOverlay,
    handleDeleteProject,
  };
}
