<template>
  <!-- Unified Project Popup - for overlays -->
  <Teleport
    :to="overlayPopupTarget"
    v-if="showOverlayPopup && overlayObject && activeProject && overlayPopupTarget"
  >
    <UnifiedProjectPopup
      :project="activeProject"
      :overlay="overlayObject"
      :viewMode="mapStore.mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      source="overlay"
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
  </Teleport>

  <!-- Unified Project Popup - for projects without overlay -->
  <Teleport :to="projectPopupTarget" v-if="showProjectPopup && activeProject && projectPopupTarget">
    <UnifiedProjectPopup
      :project="activeProject"
      :viewMode="mapStore.mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      source="marker"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @close-popup="closeProjectInfoPopup"
      @add-images="handleAddImages"
      @delete-project="handleDeleteProject"
      @draw-shapes="handleDrawShapes"
    />
  </Teleport>

  <!-- Overlay Editor Dialog - only in edit mode -->
  <OverlayEditor
    v-if="mapStore.mode === 'edit' && (overlayObject || uiStore.overlayEditDialog.overlay)"
    ref="overlayEditorRef"
    :overlayObject="overlayObject"
    @update="handleOverlayUpdate"
  />
</template>

<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { overlayPopupTarget, projectPopupTarget } from "@/services/map/popupState";
import { map } from "@/services/core/map";

import { navigateToOverlay, updateOverlayInfo } from "@/services/overlay/overlayActions";
import { useToast } from "@/composables/ui/useToast";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { closeProjectPopupAndResetMarkers } from "@/services/map/standaloneProjectMarkers";
import { getPopupLatLng } from "@/services/map/projectPopupTeleport";
import type { OverlayData, OverlayObject, Project } from "@/types/index";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import { resolveShapeEditorGeometry } from "@/services/shape/shapeEditorGeometry";
import { createProjectObject } from "@/utils/typeFactories";

const UnifiedProjectPopup = defineAsyncComponent(
  () => import("@/components/map/popups/UnifiedProjectPopup.vue"),
);
const OverlayEditor = defineAsyncComponent(() => import("@/components/map/OverlayEditor.vue"));

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
const { isSubmitting, prepareOverlaySubmission, prepareProjectWithOverlaysSubmission } =
  useSubmissionDialog();

// Ref for overlay editor component
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);

// Track teleport target existence using reactive state (no MutationObserver)

// Computed for overlay popup visibility
const showOverlayPopup = computed(() => showInfoPopup.value && overlayPopupTarget.value);

// Computed for project popup visibility
const showProjectPopup = computed(() => {
  return projectInfoPopup.value.visible && activeProject.value && projectPopupTarget.value;
});

// Get the overlay object for the info popup
const overlayObject = computed(() => {
  if (!infoPopupOverlayId.value || !overlays.value[infoPopupOverlayId.value]) {
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
  if (projectInfoPopup.value.projectId) {
    const localProject = getEffectiveProject(projectInfoPopup.value.projectId);
    if (localProject) return localProject;

    if (projectInfoPopup.value.project) return projectInfoPopup.value.project;
  }

  return undefined;
});

async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = activeProject.value;
  prepareOverlaySubmission(overlay, project);
}

async function handlePublishProject() {
  const project = activeProject.value;
  if (!project) return;

  const projectModified = project.isModified ?? false;
  prepareProjectWithOverlaysSubmission(project, projectModified);
}

function handleEditProject(project: Project) {
  uiStore.openProjectEditForm(project);
}

function handleEditOverlay() {
  overlayEditorRef.value?.openDialog();
}

function handleOverlayUpdate(overlayId: string, caption?: string) {
  if (caption === undefined) return;

  updateOverlayInfo(overlayId, { caption });
}

function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  closeProjectPopupAndResetMarkers();
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
  // Capture geometry from popup context before closing popups (refs become null after).
  const fallbackGeometry =
    overlayObject.value?.project?.geometry ?? projectInfoPopup.value.project?.geometry ?? null;

  const existingGeometry = await resolveShapeEditorGeometry(project.id, fallbackGeometry);

  const reopenAt = showProjectPopup.value ? getPopupLatLng() : null;
  uiStore.openShapeEditor(project, reopenAt ?? undefined);
  if (showOverlayPopup.value) overlayStore.hideInfoPopup();
  else closeProjectInfoPopup();
  const { initShapeEditor } = await import("@/services/shape/shapeEditing");
  await initShapeEditor(map.value, existingGeometry ?? undefined);
}

async function handleDeleteProject(project: Project) {
  await deleteProjectWithConfirm(project.id, project.name, project.overlayIds?.length ?? 0, () => {
    if (showOverlayPopup.value) {
      overlayStore.hideInfoPopup();
    } else if (showProjectPopup.value) {
      closeProjectInfoPopup();
    }
  });
}
</script>
