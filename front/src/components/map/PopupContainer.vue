<template>
  <!-- Overlay Popup -->
  <Teleport
    to="#info-popup-teleport-target"
    v-if="showOverlayPopup && overlayObject && teleportTargetExists"
  >
    <OverlayPopup
      :overlayObject="overlayObject"
      :project="currentProject"
      :viewMode="!isEditMode"
      :publishLoading="isPublishingOverlay"
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
      :viewMode="!isEditMode"
      :publishLoading="isPublishingProject"
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
import { useApprovedOverlayChanges } from '@composables/overlay/useApprovedOverlayChanges';
import { useFieldChanges } from '@composables/changes/useFieldChanges';
import { citiesWithProjects, cleanupProjectInfoTeleportTarget } from '@composables/map/useCityMarkers';
import { updateOverlayMarkersColors } from '@composables/map/useOverlayMarkerUpdates';
import type { OverlayObject, Project } from '@types';

const OverlayPopup = defineAsyncComponent(() => import('./popups/OverlayPopup.vue'));
const DevelopmentProjectPopup = defineAsyncComponent(() => import('./popups/DevelopmentProjectPopup.vue'));
const OverlayEditor = defineAsyncComponent(() => import('./OverlayEditor.vue'));

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId, isEditMode } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { currentCityOverlays } = storeToRefs(mapStore);
const { projectInfoPopup } = storeToRefs(uiStore);
const toast = useToast();
const { t } = useI18n();
const { isPublishing: isPublishingOverlay, publishOverlay } = useOverlayPublisher();
const { isPublishing: isPublishingProject, publishProject } = useProjectPublisher();
const { submitApprovedOverlayChanges } = useApprovedOverlayChanges();
const { submitMultipleFieldChanges } = useFieldChanges();

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
    overlayIds: [],
    savedRemotely: true
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
    computed(() => overlays.value),
    computed(() => isEditMode.value)
  );
}

// AI : Handle overlay publishing (overlay mode only)
async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = currentProject.value;
  const overlayModified = overlay.isModified || false;
  const projectModified = project && !project.savedRemotely;

  try {
    // AI : Handle overlay changes
    if (overlayModified) {
      // AI : Check if this is an approved overlay being modified - submit change request instead
      if (overlay.status === 'approved') {
        await submitApprovedOverlayChanges(overlay);
      } else {
        await publishOverlay(overlay, project);
      }
    }

    // AI : Handle project changes
    if (projectModified && project) {
      if (project.status === 'pending') {
        // AI : For pending projects, publish directly
        await publishProject(project);
      } else if (project.status === 'approved' && project.originalData) {
        // AI : For approved projects, submit change requests
        const changes: Array<{ fieldName: string; oldValue: any; newValue: any }> = [];
        
        // AI : Compare current data with original data to find changes
        const fieldsToCheck: Array<keyof typeof project.originalData> = [
          'name', 'description', 'sourceUrl', 'proposalDate', 'startDate', 'endDate', 'latestUpdateOn'
        ];
        
        fieldsToCheck.forEach(field => {
          const oldValue = project.originalData?.[field];
          const newValue = project[field];
          if (oldValue !== newValue) {
            changes.push({
              fieldName: String(field),
              oldValue,
              newValue
            });
          }
        });
        
        if (changes.length > 0) {
          await submitMultipleFieldChanges('project', project.id, changes);
        }
      }
    }

    // AI : Show success message
    const message = overlayModified && projectModified 
      ? 'Changes submitted successfully'
      : overlayModified 
        ? t('overlay.publishSuccess')
        : t('project.publishSuccess');
    
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: message,
      life: 3000
    });
  } catch (error: any) {
    console.error('Error publishing changes:', error);
    toast.add({
      severity: 'error',
      summary: 'Publish Failed',
      detail: error.message || 'Failed to publish changes',
      life: 5000
    });
  }
}

// AI : Handle project publishing (project mode only)
async function handlePublishProject() {
  const project = selectedProject.value;
  if (!project) return;

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