<template>
  <!-- Unified Project Popup - for overlays -->
  <Teleport
    :to="overlayPopupTarget"
    v-if="showOverlayPopup && overlayObject && activeProject && overlayPopupTarget"
  >
    <UnifiedProjectPopup
      :project="activeProject"
      :overlay="overlayObject"
      :viewMode="mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      :availableCities="availableCities"
      source="overlay"
      @publish-overlay="handlePublishOverlay"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @edit-overlay="handleEditOverlay"
      @add-images="handleAddImages"
      @view-original-overlay="handleViewOriginalOverlay"
      @delete-project="handleDeleteProject"
      @delete-overlay="handleDeleteOverlay"
    />
  </Teleport>

  <!-- Unified Project Popup - for projects without overlay -->
  <Teleport :to="projectPopupTarget" v-if="showProjectPopup && activeProject && projectPopupTarget">
    <UnifiedProjectPopup
      :project="activeProject"
      :viewMode="mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      :availableCities="availableCities"
      source="marker"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @close-popup="closeProjectInfoPopup"
      @add-images="handleAddImages"
      @delete-project="handleDeleteProject"
    />
  </Teleport>

  <!-- AI : Overlay Editor Dialog - renders when local overlay exists OR store has overlay -->
  <OverlayEditor
    v-if="overlayObject || uiStore.overlayEditDialog.overlay"
    ref="overlayEditorRef"
    :overlayObject="overlayObject"
    @update="handleOverlayUpdate"
  />

  <!-- Submission Confirmation Dialog -->
  <SubmissionConfirmationDialog
    v-model:visible="showSubmissionDialog"
    :summary="submissionSummary"
    :is-submitting="isSubmitting"
    @confirm="confirmSubmission"
    @cancel="cancelSubmission"
    @remove-change="handleRemoveChange"
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

import { navigateToOverlay } from "@/services/overlay/overlay";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { useToast } from "@/composables/ui/useToast";
import { useSubmissionDialog } from "@/composables/submission/useSubmissionDialog";
import { citiesWithProjects } from "@/services/map/cityMarkers";
import { closeProjectPopupAndResetMarkers } from "@/services/map/standaloneProjectMarkers";
import type { OverlayObject, Project } from "@/types/index";
import { useProjectDeletion } from "@/composables/project/useProjectDeletion";
import type { DBProject, DBCity } from "../../../../back/src/db/schema";
import type { ApprovalStatus } from "@shared/types";

const UnifiedProjectPopup = defineAsyncComponent(
  () => import("@/components/map/popups/UnifiedProjectPopup.vue"),
);
const OverlayEditor = defineAsyncComponent(() => import("@/components/map/OverlayEditor.vue"));
const SubmissionConfirmationDialog = defineAsyncComponent(
  () => import("@/components/submission/SubmissionConfirmationDialog.vue"),
);

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId, mode } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { currentCityOverlays } = storeToRefs(mapStore);
const { projectInfoPopup } = storeToRefs(uiStore);
const toast = useToast();
const { t } = useI18n();
const {
  handleDeleteOverlay: deleteOverlayWithMarker,
  handleDeleteProject: deleteProjectWithConfirm,
} = useProjectDeletion();

// AI : Use shared submission dialog composable
const {
  showSubmissionDialog,
  submissionSummary,
  isSubmitting,
  prepareOverlaySubmission,
  prepareProjectWithOverlaysSubmission,
  confirmSubmission,
  cancelSubmission,
  handleRemoveChange,
} = useSubmissionDialog();

// AI : Ref for overlay editor component
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);

// AI : Computed for available cities
const availableCities = computed(() => {
  return citiesWithProjects.value.map((city) => ({
    id: city.id,
    name: city.name,
    countryCode: city.countryCode,
  }));
});

// AI : Track teleport target existence using reactive state (no MutationObserver)

// AI : Computed for overlay popup visibility
const showOverlayPopup = computed(() => showInfoPopup.value && overlayPopupTarget.value);

// AI : Computed for project popup visibility
const showProjectPopup = computed(() => {
  return projectInfoPopup.value.visible && activeProject.value && projectPopupTarget.value;
});

// AI : Get the overlay object for the info popup
const overlayObject = computed(() => {
  if (!infoPopupOverlayId.value || !overlays.value[infoPopupOverlayId.value]) {
    return null;
  }
  return overlays.value[infoPopupOverlayId.value];
});

// AI : Helper to convert backend project data and add to store
function convertAndCacheBackendProject(
  backendProject: Omit<DBProject, "status"> & { status: ApprovalStatus | null; city: DBCity },
): Project {
  // AI : CRITICAL: If project already exists, just return it to preserve overlayIds
  // AI : This fixes bug where opening info popup clears overlayIds, breaking arrow navigation
  const existingProject = projects.value[backendProject.id];
  if (existingProject) {
    return existingProject; // AI : Don't create new project, return existing one!
  }

  // AI : Project doesn't exist yet, create new one
  // AI : CRITICAL: Populate overlayIds from currently loaded overlays for this project
  // AI : Otherwise arrow navigation breaks (thinks there are 0 overlays)
  const overlaysForProject = Object.values(overlays.value)
    .filter((o) => o.projectId === backendProject.id)
    .map((o) => o.id);

  const convertedProject: Project = {
    ...backendProject,
    name: backendProject.name,
    city: backendProject.city,
    overlayIds: overlaysForProject, // AI : Use actual loaded overlays, not empty array!
  };

  // AI : Add to store for future use (or update if already exists)
  if (!projects.value[backendProject.id]) {
    projects.value = {
      ...projects.value,
      [backendProject.id]: convertedProject,
    };

    // AI : Cache original for reset functionality (critical for map popup edits)
    // AI : This is needed because this function bypasses updateProject which normally does the caching
    if (backendProject.status !== null) {
      projectStore.cacheProjectBackendState(backendProject.id);
    }
  }

  return convertedProject;
}

// AI : Unified computed property for currently active project (from either overlay or project popup)
const activeProject = computed((): Project | null => {
  // AI : Priority 1: Check if viewing an overlay popup - get project from overlay
  const overlay = overlayObject.value;
  if (overlay?.projectId) {
    // AI : Try local projects store first
    const localProject = projects.value[overlay.projectId];
    if (localProject) return localProject;

    // AI : Try allProjects (includes nearbyProjects)
    const allProjectsData = projectStore.allProjects;
    if (allProjectsData[overlay.projectId]) return allProjectsData[overlay.projectId];

    // AI : Try to find backend project data from overlay or city overlays
    const backendProject =
      overlay.project?.id === overlay.projectId
        ? overlay.project
        : currentCityOverlays.value.find(
            (cityOverlay) => cityOverlay.project?.id === overlay.projectId,
          )?.project;

    if (backendProject) return convertAndCacheBackendProject(backendProject);
  }

  // AI : Priority 2: Check if viewing a project popup - get project from project popup state
  if (projectInfoPopup.value.projectId) {
    // AI : Try local projects store first
    const localProject = projects.value[projectInfoPopup.value.projectId];
    if (localProject) return localProject;

    // AI : Try project from popup state (for backend projects)
    if (projectInfoPopup.value.project) return projectInfoPopup.value.project;
  }

  return null;
});

// AI : Handle overlay publishing (overlay mode only) - uses shared composable
async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = activeProject.value;
  prepareOverlaySubmission(overlay, project);
}

// AI : Handle project publishing (project mode only) - uses shared composable
// AI : Uses prepareProjectWithOverlaysSubmission for UNIFIED behavior with MyContributions panel
async function handlePublishProject() {
  const project = activeProject.value;
  if (!project) return;

  const projectModified = project.isModified ?? false;
  prepareProjectWithOverlaysSubmission(project, projectModified);
}

// AI : Handle project editing (both modes)
function handleEditProject(project: Project) {
  uiStore.openProjectEditForm(project);
}

// AI : Handle overlay editing (overlay mode only)
function handleEditOverlay(overlay: OverlayObject) {
  overlayEditorRef.value?.openDialog();
}

// AI : Handle overlay update (overlay mode only)
function handleOverlayUpdate(overlayId: string, caption?: string) {
  const overlay = overlays.value[overlayId];
  if (!overlay || caption === undefined) return;

  // AI : Use store action for consistent state management (instead of direct mutation)
  overlayStore.updateOverlay(overlayId, {
    caption,
    isModified: true,
  });

  // AI : Update marker tooltip to reflect the new caption
  // AI : Get the updated overlay from store after the update
  const updatedOverlay = overlays.value[overlayId];
  if (updatedOverlay) {
    updateMarkerTooltip(updatedOverlay);
  }
}

// AI : Close project info popup (project mode only)
function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  closeProjectPopupAndResetMarkers();
}

// AI : Handle view original overlay - navigate to the original overlay being replaced
async function handleViewOriginalOverlay(originalOverlayId: string) {
  try {
    // AI : Navigate to the original overlay using the overlay ID
    // AI : The navigateToOverlay function will fetch and render the overlay if needed
    const success = await navigateToOverlay(originalOverlayId, true, true);

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

// AI : Handle add images button - open dialog for image upload instructions
function handleAddImages() {
  // AI : Get currently active project (works for both overlay and project popups)
  const project = activeProject.value;
  if (!project) return;

  // AI : Open the instructional dialog
  uiStore.openImageUploadDialog(project.id);
}

// AI : Handle overlay deletion and show standalone project marker if last overlay
async function handleDeleteOverlay(overlay: OverlayObject) {
  const project = activeProject.value;
  const projectId = project?.id;

  // AI : Count overlays in the overlayStore that belong to this project
  const overlaysForProject = projectId
    ? Object.values(overlays.value).filter((o) => o.projectId === projectId)
    : [];
  const overlayCount = overlaysForProject.length;

  await deleteOverlayWithMarker(overlay.id, project, overlayCount, overlay.caption, () => {
    overlayStore.hideInfoPopup();
  });
}

// AI : Handle project deletion
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
