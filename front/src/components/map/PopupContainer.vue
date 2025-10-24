<template>
  <!-- Overlay Popup -->
  <Teleport
    to="#info-popup-teleport-target"
    v-if="showOverlayPopup && overlayObject && teleportTargetExists"
  >
    <OverlayPopup
      :overlayObject="overlayObject"
      :project="currentProject"
      :viewMode="mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      :availableCities="availableCities"
      @project-change="handleProjectChange"
      @publish-overlay="handlePublishOverlay"
      @edit-project="handleEditProject"
      @edit-overlay="handleEditOverlay"
      @overlay-update="handleOverlayUpdate"
    />
  </Teleport>

  <!-- Development Project Popup -->
  <Teleport
    to="#project-info-popup-teleport-target"
    v-if="showProjectPopup && selectedProject"
  >
    <DevelopmentProjectPopup
      :project="selectedProject"
      :viewMode="mode !== 'edit'"
      :publishLoading="isSubmitting"
      :loading="false"
      :availableCities="availableCities"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @close-popup="closeProjectInfoPopup"
    />
  </Teleport>

  <!-- Overlay Editor Dialog -->
  <OverlayEditor
    v-if="overlayObject"
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
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useUiStore } from '@stores/uiStore';

import { updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useOverlayPublisher } from '@composables/overlay/useOverlayPublisher';
import { useProjectPublisher } from '@composables/project/useProjectPublisher';
import { useSubmissionService } from '@composables/submission/useSubmissionService';
import type { SubmissionContext, SubmissionSummary } from '@composables/submission/useSubmissionService';
import { citiesWithProjects, cleanupProjectInfoTeleportTarget } from '@composables/map/useCityMarkers';
import { updateOverlayMarkersColors } from '@composables/map/useOverlayMarkerUpdates';
import type { OverlayObject, Project } from '@types';

const OverlayPopup = defineAsyncComponent(() => import('./popups/OverlayPopup.vue'));
const DevelopmentProjectPopup = defineAsyncComponent(() => import('./popups/DevelopmentProjectPopup.vue'));
const OverlayEditor = defineAsyncComponent(() => import('./OverlayEditor.vue'));
const SubmissionConfirmationDialog = defineAsyncComponent(() => import('@components/submission/SubmissionConfirmationDialog.vue'));

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
const { publishOverlay } = useOverlayPublisher();
const { publishProject } = useProjectPublisher();
const submissionService = useSubmissionService();

// AI : Submission dialog state
const showSubmissionDialog = ref(false);
const submissionSummary = ref<SubmissionSummary | null>(null);
const pendingSubmissionContext = ref<SubmissionContext | null>(null);
const isSubmitting = ref(false);

// AI : Computed for available cities
const availableCities = computed(() => {
  return citiesWithProjects.value.map(city => ({
    id: city.id,
    name: city.name,
    countryCode: city.countryCode
  }));
});

// AI : Computed for overlay popup visibility
const showOverlayPopup = computed(() => showInfoPopup.value);

// AI : Computed for project popup visibility  
const showProjectPopup = computed(() => {
  return projectInfoPopup.value.visible && selectedProject.value && teleportTargetExists.value;
});

// AI : Get selected project for project popup
const selectedProject = computed(() => {
  if (!projectInfoPopup.value.projectId) return null;

  // AI : First try to get from local projects store
  const localProject = projects.value[projectInfoPopup.value.projectId];
  if (localProject) return localProject;

  // AI : If not found locally, try to get from projectInfoPopup (for backend projects)
  return projectInfoPopup.value.project || null;
});

// AI : Track teleport target existence
let targetObserver: MutationObserver | null = null;
const teleportTargetExists = ref(false);

// AI : Ref for overlay editor component
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);

// AI : Check if teleport targets exist (we need both for overlay and project popups)
const checkTeleportTarget = () => {
  const overlayTarget = document.getElementById('info-popup-teleport-target');
  const projectTarget = document.getElementById('project-info-popup-teleport-target');
  teleportTargetExists.value = !!(overlayTarget || projectTarget);
};

onMounted(() => {
  checkTeleportTarget();

  targetObserver = new MutationObserver(() => {
    checkTeleportTarget();
  });

  targetObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
});

onUnmounted(() => {
  if (targetObserver) {
    targetObserver.disconnect();
  }
});

// AI : Get the overlay object for the info popup
const overlayObject = computed(() => {
  if (!infoPopupOverlayId.value || !overlays.value[infoPopupOverlayId.value]) {
    return null;
  }
  return overlays.value[infoPopupOverlayId.value];
});

// AI : Helper to convert backend project data and add to store
function convertAndCacheBackendProject(backendProject: any): Project {
  const convertedProject: Project = {
    ...backendProject,
    name: backendProject.name,
    city: backendProject.city,
    overlayIds: []
  };

  // AI : Add to store for future use
  if (!projects.value[backendProject.id]) {
    projects.value = {
      ...projects.value,
      [backendProject.id]: convertedProject
    };
  }

  return convertedProject;
}

// AI : Get project for overlay - computed to ensure reactivity when projectId changes
const currentProject = computed((): Project | null => {
  const overlay = overlayObject.value;
  if (!overlay?.projectId) return null;

  // AI : First try to get from local projects store
  const localProject = projects.value[overlay.projectId];
  if (localProject) {
    return localProject;
  }

  // AI : Try to get from allProjects (includes nearbyProjects)
  const allProjectsData = projectStore.allProjects;
  if (allProjectsData[overlay.projectId]) {
    return allProjectsData[overlay.projectId];
  }

  // AI : Try to find backend project data from overlay or city overlays
  const backendProject = overlay.project?.id === overlay.projectId
    ? overlay.project
    : currentCityOverlays.value.find(cityOverlay => cityOverlay.project?.id === overlay.projectId)?.project;

  if (backendProject) {
    return convertAndCacheBackendProject(backendProject);
  }

  return null;
});

// AI : Handle project change (overlay mode only)
async function handleProjectChange(projectId: string) {
  const overlay = overlayObject.value;
  if (!overlay) return;

  // AI : Create a new overlay object with updated projectId
  // AI : Clear the old project reference so currentProject computed can find the new one
  const updatedOverlay: OverlayObject = {
    ...overlay,
    projectId: projectId,
    project: undefined, // AI : Let currentProject computed find the new project
    isModified: true
  };

  // AI : Update the overlays store with the new overlay object
  overlays.value = {
    ...overlays.value,
    [overlay.id]: updatedOverlay
  };

  // AI : Update marker color and tooltip to reflect modification
  updateMarkerTooltip(updatedOverlay);

  // AI : Update all overlay marker colors if city markers are visible
  updateOverlayMarkersColors(
    computed(() => overlays.value)
  );
}

// AI : Prepare submission context and show confirmation dialog
async function prepareAndShowSubmissionDialog(context: SubmissionContext) {
  try {
    // AI : Validate submission
    const validation = submissionService.validate(context);
    if (!validation.isValid) {
      toast.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: validation.errors.join(', '),
        life: 5000
      });
      return;
    }

    // AI : Build summary for confirmation dialog
    submissionSummary.value = submissionService.buildSummary(context);
    pendingSubmissionContext.value = context;
    showSubmissionDialog.value = true;
  } catch (error: any) {
    console.error('Error preparing submission:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message || 'Failed to prepare submission',
      life: 5000
    });
  }
}

// AI : Confirm submission after user approves in dialog
async function confirmSubmission() {
  if (!pendingSubmissionContext.value) return;

  try {
    isSubmitting.value = true;

    // @ts-expect-error - Complex Pinia store types cause deep instantiation errors
    await submissionService.submit(pendingSubmissionContext.value);

    // AI : Show success message
    const context = pendingSubmissionContext.value;
    const message = context.changeType === 'update_approved'
      ? t('submission.changeRequestSubmitted')
      : context.changeType === 'update_pending'
        ? t('submission.changesSaved')
        : t('submission.submissionSuccessful');

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: message,
      life: 3000
    });

    // AI : Close dialog and reset state
    showSubmissionDialog.value = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  } catch (error: any) {
    console.error('Error submitting:', error);
    toast.add({
      severity: 'error',
      summary: 'Submission Failed',
      detail: error.message || 'Failed to submit changes',
      life: 5000
    });
  } finally {
    isSubmitting.value = false;
  }
}

// AI : Cancel submission dialog
function cancelSubmission() {
  showSubmissionDialog.value = false;
  pendingSubmissionContext.value = null;
  submissionSummary.value = null;
}

// AI : Handle overlay publishing (overlay mode only) - NEW UNIFIED APPROACH
async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = currentProject.value;
  const overlayModified = overlay.isModified || false;

  // AI : Handle overlay changes using new overlay publisher for new overlays
  if (overlayModified && overlay.status !== 'approved') {
    try {
      await publishOverlay(overlay, project);
      toast.add({
        severity: 'success',
        summary: t('overlay.publishSuccess'),
        detail: t('overlay.publishSuccessDetail'),
        life: 3000
      });
    } catch (error: any) {
      console.error('Error publishing overlay:', error);
      toast.add({
        severity: 'error',
        summary: t('overlay.publishFailed'),
        detail: error.message || t('overlay.publishFailedDetail'),
        life: 5000
      });
      return;
    }
  }

  // AI : Handle overlay changes for approved overlays using unified submission service
  if (overlayModified && overlay.status === 'approved') {
    const context: SubmissionContext = {
      entityType: 'overlay',
      entityId: overlay.id,
      entity: overlay,
      changeType: submissionService.getChangeType(overlay)
    };

    await prepareAndShowSubmissionDialog(context);
  }
}

// AI : Handle project publishing (project mode only) - NEW UNIFIED APPROACH
async function handlePublishProject() {
  const project = selectedProject.value;
  if (!project) return;

  // AI : For pending/new projects, check if we need unified service or direct publish
  if (project.status === 'pending' || !project.status) {
    // AI : Use unified service for consistent validation and summary
    const context: SubmissionContext = {
      entityType: 'project',
      entityId: project.id,
      entity: project,
      changeType: submissionService.getChangeType(project)
    };

    await prepareAndShowSubmissionDialog(context);
  } else if (project.status === 'approved') {
    // AI : For approved projects with changes, use unified service
    const context: SubmissionContext = {
      entityType: 'project',
      entityId: project.id,
      entity: project,
      changeType: 'update_approved'
    };

    await prepareAndShowSubmissionDialog(context);
  } else {
    // AI : Fallback to direct publish for other cases
    try {
      await publishProject(project);
      toast.add({
        severity: 'success',
        summary: t('project.publishSuccess'),
        detail: t('project.publishSuccessDetail'),
        life: 3000
      });
    } catch (error) {
      console.error('Error publishing project:', error);
      toast.add({
        severity: 'error',
        summary: t('project.publishFailed'),
        detail: t('project.publishFailedDetail'),
        life: 5000
      });
    }
  }
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
  if (overlay && caption !== undefined) {
    overlay.caption = caption;
    overlay.isModified = true;
  }
}

// AI : Close project info popup (project mode only)
function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  cleanupProjectInfoTeleportTarget();
}

</script>