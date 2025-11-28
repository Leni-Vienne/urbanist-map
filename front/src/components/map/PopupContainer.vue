<template>
  <!-- Unified Project Popup - for overlays -->
  <Teleport
    to="#info-popup-teleport-target"
    v-if="showOverlayPopup && overlayObject && activeProject && teleportTargetExists"
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
  <Teleport
    to="#project-info-popup-teleport-target"
    v-if="showProjectPopup && activeProject"
  >
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

import { updateMarkerTooltip, navigateToOverlay, addOverlay } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useOverlayPublisher } from '@composables/overlay/useOverlayPublisher';
import { useSubmissionService } from '@composables/submission/useSubmissionService';
import type { SubmissionContext, SubmissionSummary } from '@composables/submission/useSubmissionService';
import { citiesWithProjects, cleanupProjectInfoTeleportTarget } from '@composables/map/useCityMarkers';
import type { OverlayObject, Project } from '@types';
import { useProjectDeletion } from '@composables/project/useProjectDeletion';
import type { DBProject, DBCity } from '../../../../back/src/db/schema';

const UnifiedProjectPopup = defineAsyncComponent(() => import('./popups/UnifiedProjectPopup.vue'));
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
const submissionService = useSubmissionService();
const { handleDeleteOverlay: deleteOverlayWithMarker, handleDeleteProject: deleteProjectWithConfirm } = useProjectDeletion();

// AI : Submission dialog state
const showSubmissionDialog = ref(false);
const submissionSummary = ref<SubmissionSummary | null>(null);
const pendingSubmissionContext = ref<SubmissionContext | null>(null);
const isSubmitting = ref(false);

// AI : Track teleport target existence
let targetObserver: MutationObserver | null = null;
const teleportTargetExists = ref(false);

// AI : Ref for overlay editor component
const overlayEditorRef = ref<InstanceType<typeof OverlayEditor> | null>(null);

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
  return projectInfoPopup.value.visible && activeProject.value && teleportTargetExists.value;
});

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
function convertAndCacheBackendProject(backendProject: DBProject & { city: DBCity }): Project {
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
    const backendProject = overlay.project?.id === overlay.projectId
      ? overlay.project
      : currentCityOverlays.value.find(cityOverlay => cityOverlay.project?.id === overlay.projectId)?.project;

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
async function confirmSubmission(reason: string) {
  if (!pendingSubmissionContext.value) return;

  try {
    isSubmitting.value = true;

    // @ts-expect-error - Complex Pinia store types cause deep instantiation errors
    await submissionService.submit(pendingSubmissionContext.value, reason);

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

    // AI : Close the appropriate popup after successful submission
    if (context.entityType === 'overlay' && showOverlayPopup.value) {
      overlayStore.hideInfoPopup();
    } else if (context.entityType === 'project' && showProjectPopup.value) {
      closeProjectInfoPopup();
    }

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

  const project = activeProject.value;
  const overlayModified = overlay.isModified || false;
  const projectModified = project?.isModified || false;

  // AI : Handle project-only changes
  if (projectModified && !overlayModified && project) {
    const context: SubmissionContext = {
      entityType: 'project',
      entityId: project.id,
      entity: project,
      changeType: submissionService.getChangeType(project)
    };

    await prepareAndShowSubmissionDialog(context);
    return;
  }

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

      // AI : If project was also modified and approved, submit change request for project
      if (projectModified && project?.status === 'approved') {
        const projectContext: SubmissionContext = {
          entityType: 'project',
          entityId: project.id,
          entity: project,
          changeType: 'update_approved'
        };
        await prepareAndShowSubmissionDialog(projectContext);
      } else {
        // AI : Close popup after successful publish (if no project changes to submit)
        overlayStore.hideInfoPopup();
      }
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
  const project = activeProject.value;
  if (!project) return;

  // AI : Always use unified submission service - it determines the correct flow based on status
  const context: SubmissionContext = {
    entityType: 'project',
    entityId: project.id,
    entity: project,
    changeType: submissionService.getChangeType(project)
  };

  await prepareAndShowSubmissionDialog(context);
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

  // AI : Create a new overlay object to trigger reactivity (overlays is a shallowRef)
  const updatedOverlay: OverlayObject = {
    ...overlay,
    caption,
    isModified: true
  };

  // AI : Update the overlays store with the new overlay object
  overlays.value = {
    ...overlays.value,
    [overlayId]: updatedOverlay
  };

  // AI : Update marker tooltip to reflect the new caption
  updateMarkerTooltip(updatedOverlay);
}

// AI : Close project info popup (project mode only)
function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  cleanupProjectInfoTeleportTarget();
}

// AI : Handle view original overlay - navigate to the original overlay being replaced
async function handleViewOriginalOverlay(originalOverlayId: string) {
  try {
    // AI : Navigate to the original overlay using the overlay ID
    // AI : The navigateToOverlay function will fetch and render the overlay if needed
    const success = await navigateToOverlay(originalOverlayId, true, true);

    if (!success) {
      toast.add({
        severity: 'error',
        summary: t('overlay.navigationFailed'),
        detail: t('overlay.failedToNavigate'),
        life: 3000
      });
    }
  } catch (error) {
    console.error('Failed to navigate to original overlay:', error);
    toast.add({
      severity: 'error',
      summary: t('overlay.navigationFailed'),
      detail: error instanceof Error ? error.message : t('overlay.failedToNavigate'),
      life: 3000
    });
  }
}

// AI : Handle add images button - directly open file picker for overlay upload
function handleAddImages() {
  // AI : Get currently active project (works for both overlay and project popups)
  const project = activeProject.value;
  if (!project) return;

  // AI : Create hidden file input to trigger file picker
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png, image/jpeg, image/jpg, image/webp';
  fileInput.style.display = 'none';

  fileInput.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      // AI : Read file as data URL for overlay creation
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const projectId = project.id;

          // AI : Create overlay directly for this project
          addOverlay(reader.result as string, projectId);

          // AI : Close the popup after adding overlay
          if (showOverlayPopup.value) {
            overlayStore.hideInfoPopup();
          } else if (showProjectPopup.value) {
            closeProjectInfoPopup();
          }

          toast.add({
            severity: 'success',
            summary: t('overlay.overlayCreated'),
            detail: t('overlay.positionOverlayOnMap'),
            life: 3000
          });
        } catch (error) {
          console.error('Error creating overlay:', error);
          toast.add({
            severity: 'error',
            summary: t('overlay.uploadFailed'),
            detail: t('overlay.uploadFailedDetail'),
            life: 3000
          });
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error handling file upload:', error);
      toast.add({
        severity: 'error',
        summary: t('overlay.uploadFailed'),
        detail: t('overlay.uploadFailedDetail'),
        life: 3000
      });
    } finally {
      // AI : Cleanup file input
      document.body.removeChild(fileInput);
    }
  };

  // AI : Trigger file picker
  document.body.appendChild(fileInput);
  fileInput.click();
}

// AI : Handle overlay deletion and show development marker if last overlay
async function handleDeleteOverlay(overlay: OverlayObject) {
  const project = activeProject.value;
  const projectId = project?.id;

  // AI : Count overlays in the overlayStore that belong to this project
  const overlaysForProject = projectId
    ? Object.values(overlays.value).filter(o => o.projectId === projectId)
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
