import type { ComputedRef } from "vue";
import { useI18n } from "vue-i18n";

import { isMobile } from "@/services/core/viewport";
import { deleteChangeRequest } from "@/services/changes/changeRequests";
import { confirmAndDeleteOverlay, confirmAndDeleteProject } from "@/services/entity/entityRemoval";
import { prepareSubmission } from "@/services/submission/submissionDialog";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { isOverlayUnsaved, isProjectUnsaved } from "@/services/overlay/unsavedState";
import { startShapeEditing } from "@/services/shape/shapeEditorLazy";
import { openProjectDetail } from "@/services/core/projectSelection";
import { closeDetail } from "@/services/overlay/selection";
import { ensureOverlayLoaded } from "@/services/overlay/navigation";
import { flyToGeometry } from "@/services/core/mapNavigation";
import { clearStagedRender, hasStagedRender } from "@/services/submission/stagedRenderState";
import type { ChangeRequest } from "@/stores/changeRequestStore";
import type { Project, Overlay, ContributionProject } from "@/types/index";
import { toastError, toastSuccess, toastWarn } from "@/services/core/toast";

// A render staged in the upload dialog but not yet submitted: kind 'render' with no status. Real
// renders always carry a server status, so this uniquely identifies a still-staged one.
function isStagedRenderOverlay(overlay: Overlay): boolean {
  return overlay.kind === "render" && !overlay.status;
}

async function handleDeleteProjectClick(project: ContributionProject): Promise<void> {
  await confirmAndDeleteProject(project.id, project.name, project.overlays.length);
}

// New project button click: opens the marker placement bar (after an auth gate and a clean slate).
function handleNewProjectClick(): void {
  const authStore = useAuthStore();
  const uiStore = useUiStore();

  if (!authStore.isAuthenticated) {
    uiStore.openAuthModal();
    return;
  }

  // Close any open detail and clear selection for a clean slate
  closeDetail();

  // Always switch to edit mode when contributing (no-op if already in edit mode)
  useMapStore().setMode("edit");
  uiStore.markerPlacementBarVisible = true;
}

export function useContributeActions(allContributions: ComputedRef<ContributionProject[]>) {
  const { t } = useI18n();

  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const focusStore = useFocusStore();

  function isOverlayModified(overlayId: string): boolean {
    const overlay = overlayStore.liveOverlays[overlayId];
    return overlay ? isOverlayUnsaved(overlay) : false;
  }

  function isProjectModified(projectId: string): boolean {
    const projectInStore = projectStore.projects[projectId];
    if (projectInStore && isProjectUnsaved(projectInStore)) return true;
    if (hasStagedRender(projectId)) return true;

    const project = allContributions.value.find((p) => p.id === projectId);
    return project?.overlays.some((o) => isOverlayModified(o.id)) ?? false;
  }

  async function handleDeleteOverlayClick(overlay: Overlay): Promise<void> {
    // A staged render has no overlay row to delete: drop it from stagedRenderState.
    if (isStagedRenderOverlay(overlay) && overlay.projectId) {
      clearStagedRender(overlay.projectId);
      return;
    }

    await confirmAndDeleteOverlay(overlay.id, overlay.caption);
  }

  async function handleDeleteChangeRequestClick(change: ChangeRequest): Promise<void> {
    const fieldName = change.fieldName;
    const confirmed = confirm(t("contribute.confirmDeleteChangeRequest", { field: fieldName }));
    if (!confirmed) return;

    const result = await deleteChangeRequest(change.id);
    if (result) {
      toastSuccess(t("contribute.changeRequestDeleted"));
    } else {
      toastError(t("contribute.changeRequestDeleteError"));
    }
  }

  async function handleEditOverlayClick(overlay: Overlay): Promise<void> {
    try {
      const loadedOverlay = await ensureOverlayLoaded(overlay.id);
      uiStore.openOverlayEditDialog(loadedOverlay.id);
    } catch (error) {
      console.error("Failed to load overlay for editing:", error);
      toastError(error instanceof Error ? error.message : t("submission.overlayUnavailable"));
    }
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
      toastWarn(t("shapes.desktopOnly"));
      return;
    }

    const approvedGeometry = project.geometry ?? null;

    closeDetail();

    uiStore.openShapeEditor(project.id);
    await startShapeEditing(project.id, approvedGeometry);
  }

  function handleExternalProjectClick(): void {
    const fullProject = focusStore.selectedProject;
    if (!fullProject) return;
    openProjectDetail(fullProject);
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

    uiStore.openProjectEditForm(projectToEdit.id);
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
