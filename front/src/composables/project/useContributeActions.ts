import type { ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/ui/useToast";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { isOverlayUnsaved, isProjectUnsaved } from "@/utils/unsavedState";
import { startShapeEditing } from "@/services/shape/shapeEditorLazy";
import { selectProject } from "@/services/map/projectSelection";
import { flyToGeometry } from "@/services/map/mapNavigation";
import { clearStagedRender } from "@/composables/submission/stagedRenderStore";
import type { ChangeRequest } from "@/stores/pinia/changeRequestStore";
import type { Project, Overlay } from "@/types/index";

// A render staged in the upload dialog but not yet submitted: kind 'render' with no status. Real
// renders always carry a server status, so this uniquely identifies a still-staged one.
function isStagedRenderOverlay(overlay: Overlay): boolean {
  return overlay.kind === "render" && !overlay.status;
}

export function useContributeActions(
  allContributions: ComputedRef<(Project & { overlays: Overlay[] })[]>,
) {
  const { t } = useI18n();
  const toast = useToast();
  const { isMobile } = useIsMobile();
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const focusStore = useFocusStore();

  const { handleNewProjectClick } = useNewProject();
  const { deleteChangeRequest } = useChangeRequests();
  const { handleDeleteOverlay, handleDeleteProject } = useProjectDeletion();
  const { prepareSubmission } = useSubmissionDialog();

  function isOverlayModified(overlayId: string): boolean {
    const overlay = overlayStore.overlays[overlayId];
    return overlay ? isOverlayUnsaved(overlay) : false;
  }

  function isProjectModified(projectId: string): boolean {
    const projectInStore = projectStore.projects[projectId];
    if (projectInStore && isProjectUnsaved(projectInStore)) return true;

    const project = allContributions.value.find((p) => p.id === projectId);
    return project?.overlays.some((o) => isOverlayModified(o.id)) ?? false;
  }

  async function handleDeleteOverlayClick(overlay: Overlay): Promise<void> {
    // A staged render has no overlay row to delete: drop it from stagedRenderStore and clear the
    // project's modified flag unless other unsaved overlays remain.
    if (isStagedRenderOverlay(overlay) && overlay.projectId) {
      const projectId = overlay.projectId;
      clearStagedRender(projectId);
      const hasOtherUnsaved = Object.values(overlayStore.overlays).some(
        (o) => o.projectId === projectId && isOverlayUnsaved(o),
      );
      projectStore.updateProject(projectId, { isModified: hasOtherUnsaved });
      return;
    }

    await handleDeleteOverlay(overlay.id, overlay.caption);
  }

  async function handleDeleteProjectClick(project: Project): Promise<void> {
    await handleDeleteProject(project.id, project.name, project.overlays?.length ?? 0);
  }

  async function handleDeleteChangeRequestClick(change: ChangeRequest): Promise<void> {
    const fieldName = change.fieldName;
    const confirmed = confirm(t("contribute.confirmDeleteChangeRequest", { field: fieldName }));
    if (!confirmed) return;

    const result = await deleteChangeRequest(change.id);
    if (result) {
      toast.add({
        severity: "success",
        summary: t("contribute.changeRequestDeleted"),
        life: 3000,
      });
    }
  }

  function handleEditOverlayClick(overlay: Overlay): void {
    // Prefer the live store object so in-memory caption changes are not lost on reopen
    const liveOverlay = overlayStore.overlays[overlay.id];
    if (liveOverlay) {
      uiStore.openOverlayEditDialog(liveOverlay);
      return;
    }
    uiStore.openOverlayEditDialog({
      id: overlay.id,
      caption: overlay.caption,
    });
  }

  function handleAddImageToProject(project: Project): void {
    uiStore.openImageUploadDialog(project.id);
  }

  function handleSaveProjectClick(project: Project): void {
    if (!isProjectModified(project.id)) return;
    prepareSubmission(project);
  }

  async function handleDrawShapesClick(project: Project): Promise<void> {
    if (isMobile.value) {
      toast.add({
        severity: "warn",
        summary: t("shapes.desktopOnly"),
        life: 3000,
      });
      return;
    }

    const approvedGeometry = project.geometry ?? null;

    focusStore.clearSelection();

    uiStore.openShapeEditor(project);
    await startShapeEditing(project.id, approvedGeometry);
  }

  // Navigate to the external pinned project using the same logic as a map click. The Project
  // argument lacks geometry; the resolved selection carries the lat/lng/geometry needed to fly.
  function handleExternalProjectClick(_project: Project): void {
    const fullProject = focusStore.selectedProject;
    if (!fullProject) return;
    selectProject(fullProject);
    if (typeof fullProject.lat === "number" && typeof fullProject.lng === "number") {
      flyToGeometry([fullProject.lat, fullProject.lng], fullProject.geometrySizeM ?? 0);
    }
  }

  function handleEditProjectClick(project: Project): void {
    const latestProjectData = allContributions.value.find((p) => p.id === project.id);
    const projectToEdit = latestProjectData ?? project;

    if (projectToEdit.id && projectToEdit.status !== null && !projectToEdit.isModified) {
      projectStore.cacheProjectBackendState(projectToEdit.id);
    }

    uiStore.openProjectEditForm(projectToEdit);
  }

  return {
    isStagedRenderOverlay,
    isProjectModified,
    handleNewProjectClick,
    handleDeleteOverlayClick,
    handleDeleteProjectClick,
    handleDeleteChangeRequestClick,
    handleEditOverlayClick,
    handleAddImageToProject,
    handleSaveProjectClick,
    handleDrawShapesClick,
    handleExternalProjectClick,
    handleEditProjectClick,
  };
}
