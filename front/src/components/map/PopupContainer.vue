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
  <Teleport to="#project-info-popup-teleport-target" v-if="showProjectPopup && activeProject">
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
import { computed, ref, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import L from 'leaflet';
import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { useProjectStore } from '@/stores/pinia/projectStore';
import { useMapStore } from '@/stores/pinia/mapStore';
import { useUiStore } from '@/stores/uiStore';
import { usePendingModificationsStore } from '@/stores/pinia/pendingModificationsStore';

import { navigateToOverlay, addOverlay } from '@/composables/overlay/useOverlay';
import { updateMarkerTooltip, updateMarkerPosition } from '@/composables/overlay/useOverlayMarkers';
import { useToast } from '@/composables/ui/useToast';
import { useOverlayPublisher } from '@/composables/overlay/useOverlayPublisher';
import { useSubmissionService, type SubmissionContext, type SubmissionSummary } from '@/composables/submission/useSubmissionService';
import { citiesWithProjects, closeProjectPopupAndResetMarkers } from '@/composables/map/useCityMarkers';
import type { OverlayObject, Project } from '@/types/index';
import { buildThumbnailUrl } from '@/utils/imageUrl';
import { useProjectDeletion } from '@/composables/project/useProjectDeletion';
import type { DBProject, DBCity } from '../../../../back/src/db/schema';
import type { ApprovalStatus } from '@shared/types';

const UnifiedProjectPopup = defineAsyncComponent(() => import('./popups/UnifiedProjectPopup.vue'));
const OverlayEditor = defineAsyncComponent(() => import('./OverlayEditor.vue'));
const SubmissionConfirmationDialog = defineAsyncComponent(() => import('@/components/submission/SubmissionConfirmationDialog.vue'));

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
const pendingModsStore = usePendingModificationsStore();

// AI : Extended context type for combined overlay+project submissions
type SubmissionContextExtended = SubmissionContext & {
  projectId?: string;
  projectModified: boolean;
  overlayModified: boolean;
  allProjectModifications: ReturnType<typeof pendingModsStore.getModificationsForProject>;
};

// AI : Submission dialog state
const showSubmissionDialog = ref(false);
const submissionSummary = ref<SubmissionSummary | null>(null);
const pendingSubmissionContext = ref<SubmissionContext | SubmissionContextExtended | null>(null);
const isSubmitting = ref(false);

// AI : Build change list from pending modifications with overlay info for thumbnails
function buildOverlayChanges(mods: ReturnType<typeof pendingModsStore.getModificationsForProject>) {
  const changes: { field: string; oldValue: any; newValue: any; displayLabel: string; overlayId?: string; thumbnailUrl?: string }[] = [];
  for (const mod of mods) {
    // AI : Get overlay object from store to access filename for thumbnail
    const overlay = overlays.value[mod.overlayId];
    const thumbnailUrl = overlay?.filename
      ? buildThumbnailUrl(overlay.filename, overlay.status !== 'approved')
      : undefined;

    if (mod.caption) {
      changes.push({
        field: 'caption',
        oldValue: mod.caption.original ?? t('common.noValue'),
        newValue: mod.caption.current,
        displayLabel: t('submission.overlayCaption'),
        overlayId: mod.overlayId,
        thumbnailUrl
      });
    }
    if (mod.corners) {
      changes.push({
        field: 'corners',
        oldValue: t('submission.previousPosition'),
        newValue: t('submission.newPosition'),
        displayLabel: t('submission.overlayPosition'),
        overlayId: mod.overlayId,
        thumbnailUrl
      });
    }
  }
  return changes;
}


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
function checkTeleportTarget() {
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
function convertAndCacheBackendProject(backendProject: Omit<DBProject, 'status'> & { status: ApprovalStatus | null; city: DBCity }): Project {
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
    // AI : Note: buildSummary -> detectChanges -> detectOverlayChanges already detects
    // AI : caption and corners changes by comparing overlay to original, so we don't
    // AI : need to add from pendingModificationsStore here (that would cause duplicates)
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
    const context = pendingSubmissionContext.value;
    const project = activeProject.value;

    // AI : Check if this is an extended context (combined overlay+project submission)
    const isExtended = 'overlayModified' in context;

    if (isExtended) {
      const extCtx = context as SubmissionContextExtended;
      // AI : Handle ALL overlay changes in the project
      if (extCtx.overlayModified && extCtx.allProjectModifications?.length > 0) {
        for (const mod of extCtx.allProjectModifications) {
          const overlayId = mod.overlayId;
          const overlayObj = overlays.value[overlayId];

          if (!overlayObj) {
            console.warn(`Cannot submit changes for overlay ${overlayId}: not loaded`);
            continue;
          }

          if (overlayObj.status !== 'approved') {
            // AI : Pending overlay - publish directly
            const overlayToPublish = {
              ...overlayObj,
              caption: mod.caption?.current ?? overlayObj.caption,
              corners: mod.corners?.current ?? overlayObj.corners
            };
            await publishOverlay(overlayToPublish, project);
          } else {
            // AI : Approved overlay - submit change request
            const overlayWithChanges = {
              ...overlayObj,
              caption: mod.caption?.current ?? overlayObj.caption,
              corners: mod.corners?.current ?? overlayObj.corners
            };
            const overlayContext = submissionService.createOverlayContext(overlayWithChanges as OverlayObject, 'update_approved');
            await submissionService.submit(overlayContext, reason);
          }

          // AI : Clear overlay modifications from unified store
          pendingModsStore.clearModification(overlayId);
        }
      }

      // AI : Handle project changes
      if (extCtx.projectModified && project) {
        const projectContext = submissionService.createProjectContext(project);
        await submissionService.submit(projectContext, reason);
        projectStore.updateProject(project.id, { isModified: false });
      }

      overlayStore.hideInfoPopup();
    } else {
      // AI : Standard project-only submission (from handlePublishProject)
      await submissionService.submit(context as SubmissionContext, reason);

      if (context.entityType === 'project') {
        projectStore.updateProject(context.entityId, { isModified: false });
        if (showProjectPopup.value) {
          closeProjectInfoPopup();
        }
      }
    }

    // AI : Show success message
    const message = context.changeType === 'update_approved'
      ? t('submission.changeRequestSubmitted')
      : (context.changeType === 'update_pending'
        ? t('submission.changesSaved')
        : t('submission.submissionSuccessful'));

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

// AI : Handle removing a single change from the submission dialog
function handleRemoveChange(index: number, field: string, overlayId?: string) {
  if (!submissionSummary.value) return;

  // AI : Remove the change at the specified index from the summary
  submissionSummary.value.changes.splice(index, 1);

  // AI : Handle overlay-specific changes
  if (overlayId) {
    // AI : Get the original values BEFORE clearing - pendingMod is a reference that will be mutated
    const pendingMod = pendingModsStore.getPendingModifications(overlayId);

    // AI : CRITICAL: Capture the original values NOW before clearFieldModification mutates the object
    const capturedOriginalCaption = pendingMod?.caption?.original;
    const capturedOriginalCorners = pendingMod?.corners?.original;

    const overlayObject = overlays.value[overlayId];

    // AI : Clear only the specific field modification (not the entire overlay)
    // AI : This MUTATES the pendingMod object, so we captured values above
    const hasRemainingMods = pendingModsStore.clearFieldModification(
      overlayId,
      field as 'caption' | 'corners'
    );

    if (overlayObject) {
      // AI : Reset only the specific field that was removed
      if (field === 'corners') {
        // AI : Clear from edit mode cache
        overlayStore.removeFromEditModeCache(overlayId);

        // AI : Reset position to backend corners (use captured original if available)
        const cornersToUse = capturedOriginalCorners ?? overlayObject.corners;
        if (overlayObject.overlay && cornersToUse?.length === 4) {
          const leafletCorners = cornersToUse.map((corner: { lat: number; lng: number }) =>
            L.latLng(corner.lat, corner.lng)
          );
          overlayObject.overlay.setCorners(leafletCorners);
        }

        // AI : Update marker position
        updateMarkerPosition(overlayObject);
      } else if (field === 'caption') {
        // AI : Reset caption to original backend value
        // AI : Use the captured value from BEFORE clearFieldModification was called
        if (capturedOriginalCaption !== undefined) {
          overlayStore.updateOverlay(overlayId, { caption: capturedOriginalCaption ?? '' });
        }
      }

      // AI : Only mark as unmodified if no more modifications remain
      if (!hasRemainingMods) {
        overlayStore.updateOverlay(overlayId, { isModified: false });
      }

      // AI : Update marker tooltip to reflect new state
      updateMarkerTooltip(overlayStore.overlays[overlayId]);
    }

    // AI : Update the extended context if present and no more mods for this overlay
    if (!hasRemainingMods && pendingSubmissionContext.value && 'allProjectModifications' in pendingSubmissionContext.value) {
      const extCtx = pendingSubmissionContext.value as SubmissionContextExtended;
      extCtx.allProjectModifications = extCtx.allProjectModifications.filter(
        mod => mod.overlayId !== overlayId
      );
    }
  } else {
    // AI : For project changes (no overlayId), reset the project field to its original value
    // AI : Get the project ID from the submission context
    if (pendingSubmissionContext.value) {
      // AI : For overlay contexts, entityId is the OVERLAY ID, projectId is stored separately
      // AI : For project contexts, entityId IS the project ID
      let projectId: string | undefined = undefined;

      if ('overlayModified' in pendingSubmissionContext.value) {
        // AI : Extended overlay context - use the projectId field
        projectId = (pendingSubmissionContext.value as SubmissionContextExtended).projectId;
      } else if ('entityId' in pendingSubmissionContext.value && pendingSubmissionContext.value.entityType === 'project') {
        // AI : Project context - entityId IS the project ID
        projectId = pendingSubmissionContext.value.entityId;
      }

      if (projectId) {
        projectStore.resetProjectField(projectId, field);
      }
    }

    // AI : Close project edit form to force fresh data on reopen
    uiStore.closeProjectEditForm();
  }

  // AI : If no more changes, close the dialog
  if (submissionSummary.value.changes.length === 0) {
    cancelSubmission();
    toast.add({
      severity: 'info',
      summary: t('common.info'),
      detail: t('submission.noChangesToSubmit'),
      life: 3000
    });
  }
}

// AI : Handle overlay publishing (overlay mode only) - ALWAYS SHOW CONFIRMATION DIALOG
async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = activeProject.value;

  // AI : Get ALL pending overlay modifications for this PROJECT (not just current overlay!)
  // AI : This matches the side menu behavior which shows all changes for the project
  const projectId = project?.id ?? overlay.projectId;
  const allProjectMods = projectId ? pendingModsStore.getModificationsForProject(projectId) : [];
  const currentOverlayMod = pendingModsStore.getPendingModifications(overlay.id);

  // AI : Check if current overlay or any other overlay in project has modifications
  const hasAnyOverlayMods = allProjectMods.length > 0 || currentOverlayMod !== null || (overlay.isModified ?? false);
  const projectModified = project?.isModified ?? false;

  // AI : If nothing is modified, nothing to do
  if (!hasAnyOverlayMods && !projectModified) {
    return;
  }

  // AI : Build combined changes list from ALL overlays using helper
  const changes = buildOverlayChanges(allProjectMods);

  // AI : Add project changes from submissionService if project is modified
  if (projectModified && project) {
    const projectContext = submissionService.createProjectContext(project);
    const projectSummary = submissionService.buildSummary(projectContext);
    changes.push(...projectSummary.changes);
  }

  // AI : Determine if this requires moderation (check all modified overlays)
  const anyOverlayRequiresMod = allProjectMods.some(mod => mod.overlayStatus === 'approved') || overlay.status === 'approved';
  const projectRequiresMod = project?.status === 'approved';
  const requiresModeration = anyOverlayRequiresMod || projectRequiresMod;

  // AI : Determine action label
  let action = '';
  if (requiresModeration) {
    action = t('submission.submitChangeRequest');
  } else if (overlay.status === 'pending' || overlay.status === null) {
    action = t('overlay.publishOverlay');
  } else {
    action = t('submission.updateOverlays');
  }

  // AI : Build summary for confirmation dialog
  submissionSummary.value = {
    action,
    entityName: overlay.caption ?? project?.name ?? 'Overlay',
    changes,
    requiresModeration,
    entityType: 'overlay'
  };

  // AI : Store typed context with all info needed for confirmSubmission
  const extendedContext: SubmissionContextExtended = {
    entityType: 'overlay',
    entityId: overlay.id,
    changeType: requiresModeration ? 'update_approved' : 'update_pending',
    entity: overlay,
    projectId: project?.id,
    projectModified,
    overlayModified: hasAnyOverlayMods,
    allProjectModifications: allProjectMods
  };
  pendingSubmissionContext.value = extendedContext;

  showSubmissionDialog.value = true;
}

// AI : Handle project publishing (project mode only) - NEW UNIFIED APPROACH
async function handlePublishProject() {
  const project = activeProject.value;
  if (!project) return;

  // AI : Always use unified submission service - it determines the correct flow based on status
  const context = submissionService.createProjectContext(project);
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

  fileInput.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      // AI : Read file as data URL for overlay creation
      const reader = new FileReader();
      reader.addEventListener('load', () => {
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
      });
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
  });

  // AI : Trigger file picker
  document.body.appendChild(fileInput);
  fileInput.click();
}

// AI : Handle overlay deletion and show standalone project marker if last overlay
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
