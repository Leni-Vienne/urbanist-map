<template>
  <div class="flex flex-col h-full min-h-0 bg-content-background">
    <!-- Back header: returns to the panel's tab content -->
    <button
      type="button"
      class="flex items-center gap-2 px-4 py-2.5 border-b border-surface text-sm font-medium text-muted-color hover:text-color hover:bg-content-hover-background cursor-pointer bg-transparent shrink-0 text-left"
      @click="handleBack"
    >
      <i class="pi pi-arrow-left text-xs"></i>
      {{ $t("common.back") }}
    </button>

    <ProjectDetailView
      v-if="activeProject"
      class="flex-1 min-h-0"
      :project="activeProject"
      :overlay="overlayObject"
      :viewMode="mapStore.mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      @publish-overlay="handlePublishOverlay"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @edit-overlay="handleEditOverlay"
      @add-images="handleAddImages"
      @view-original-overlay="handleViewOriginalOverlay"
      @delete-project="handleDeleteProject"
      @delete-overlay="handleDeleteOverlay"
      @draw-shapes="handleDrawShapes"
    />
    <div v-else class="flex-1 flex justify-center items-center p-4">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";

import { navigateToOverlay } from "@/services/overlay/actions";
import { useToast } from "@/composables/ui/useToast";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { closeProjectPopupAndResetMarkers } from "@/services/map/standaloneProjectMarkers";
import type { OverlayData, OverlayObject, Project } from "@/types/index";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { startShapeEditing } from "@/services/shape/shapeEditorLazy";
import { createProjectObject } from "@/utils/typeFactories";

import ProjectDetailView from "@/components/map/popups/ProjectDetailView.vue";

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { projectInfoPopup } = storeToRefs(uiStore);
const toast = useToast();
const { t } = useI18n();
const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();

// Use submission dialog composable to trigger the singleton dialog (rendered in Home.vue)
const { isSubmitting, prepareOverlaySubmission, prepareSubmission } = useSubmissionDialog();

// Get the overlay object for the info popup
const overlayObject = computed(() => {
  if (
    !showInfoPopup.value ||
    !infoPopupOverlayId.value ||
    !overlays.value[infoPopupOverlayId.value]
  ) {
    return null;
  }
  return overlays.value[infoPopupOverlayId.value];
});

function convertAndCacheBackendProject(
  backendProject: NonNullable<OverlayData["project"]>,
): Project {
  const existing = projects.value[backendProject.id];
  if (existing) return existing;

  const overlayIds = Object.values(overlays.value)
    .filter((o) => o.projectId === backendProject.id)
    .map((o) => o.id);

  const project = createProjectObject({ ...backendProject, overlayIds });
  projects.value = { ...projects.value, [project.id]: project };
  if (project.status !== null) projectStore.cacheProjectBackendState(project.id);

  return project;
}

// In view mode, show original approved data for locally-modified projects.
function getEffectiveProject(projectId: string): Project | undefined {
  const localProject = projects.value[projectId];
  if (!localProject) return undefined;
  if (mapStore.mode !== "edit" && localProject.isModified) {
    const original = projectStore.getOriginalProject(projectId);
    if (original) return original as Project;
  }
  return localProject;
}

const activeProject = computed(() => {
  // Check overlay popup first.
  const overlay = overlayObject.value;
  if (overlay?.projectId) {
    const localProject = getEffectiveProject(overlay.projectId);
    if (localProject) return localProject;

    const backendProject = overlay.project?.id === overlay.projectId ? overlay.project : null;

    if (backendProject) return convertAndCacheBackendProject(backendProject);
  }

  // Fall back to project popup.
  if (projectInfoPopup.value.visible && projectInfoPopup.value.projectId) {
    const localProject = getEffectiveProject(projectInfoPopup.value.projectId);
    if (localProject) return localProject;

    if (projectInfoPopup.value.project) return projectInfoPopup.value.project;
  }

  return undefined;
});

async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  prepareOverlaySubmission(overlay, activeProject.value);
}

async function handlePublishProject() {
  const project = activeProject.value;
  if (!project) return;

  prepareSubmission(project);
}

function handleEditProject(project: Project) {
  uiStore.openProjectEditForm(project);
}

function handleEditOverlay(overlay: OverlayObject) {
  uiStore.openOverlayEditDialog({ id: overlay.id, caption: overlay.caption });
}

function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  closeProjectPopupAndResetMarkers();
}

// Back returns to the panel's tab list, closing whichever detail is open.
function handleBack() {
  if (showInfoPopup.value) {
    overlayStore.hideInfoPopup();
  } else {
    closeProjectInfoPopup();
  }
}

async function handleViewOriginalOverlay(originalOverlayId: string) {
  try {
    const success = await navigateToOverlay(originalOverlayId, true);

    if (!success) {
      toast.add({
        severity: "error",
        summary: t("overlay.navigationFailed"),
        detail: t("overlay.failedToNavigate"),
        life: 3000,
      });
    }
  } catch (error) {
    console.error("Failed to navigate to original overlay:", error);
    toast.add({
      severity: "error",
      summary: t("overlay.navigationFailed"),
      detail: error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      life: 3000,
    });
  }
}

function handleAddImages() {
  const project = activeProject.value;
  if (!project) return;
  uiStore.openImageUploadDialog(project.id);
}

async function handleDeleteOverlay(overlay: OverlayObject) {
  const project = activeProject.value;
  const projectId = project?.id;

  // Count overlays in the overlayStore that belong to this project
  const overlaysForProject = projectId
    ? Object.values(overlays.value).filter((o) => o.projectId === projectId)
    : [];
  const overlayCount = overlaysForProject.length;

  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.caption, () => {
    overlayStore.hideInfoPopup();
  });
}

async function handleDrawShapes(project: Project) {
  // Capture geometry from the active overlay/project before closing the detail.
  const fallbackGeometry =
    overlayObject.value?.project?.geometry ?? projectInfoPopup.value.project?.geometry ?? null;

  uiStore.openShapeEditor(project, true);
  if (showInfoPopup.value) overlayStore.hideInfoPopup();
  else closeProjectInfoPopup();
  await startShapeEditing(project.id, fallbackGeometry);
}

async function handleDeleteProject(project: Project) {
  await deleteProjectWithConfirm(project.id, project.name, project.overlayIds?.length ?? 0, () => {
    if (showInfoPopup.value) {
      overlayStore.hideInfoPopup();
    } else {
      closeProjectInfoPopup();
    }
  });
}
</script>
