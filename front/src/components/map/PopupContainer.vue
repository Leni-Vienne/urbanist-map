<template>
  <!-- Overlay Popup -->
  <Teleport to="#info-popup-teleport-target" v-if="showOverlayPopup && overlayObject && teleportTargetExists">
    <OverlayPopup
      :overlayObject="overlayObject"
      :project="getProjectForOverlay(overlayObject)"
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
  <Teleport to="#project-info-popup-teleport-target" v-if="showProjectPopup && selectedProject">
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
import { useUiStore } from '@stores/uiStore';

import { updateTooltipText } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useOverlayPublisher } from '@composables/overlay/useOverlayPublisher';
import { useProjectPublisher } from '@composables/project/useProjectPublisher';
import { citiesWithProjects, loadCityProjects } from '@composables/map/useCityMarkers';
import type { OverlayObject, Project } from '@types';

const OverlayPopup = defineAsyncComponent(() => import('./popups/OverlayPopup.vue'));
const DevelopmentProjectPopup = defineAsyncComponent(() => import('./popups/DevelopmentProjectPopup.vue'));
const OverlayEditor = defineAsyncComponent(() => import('./OverlayEditor.vue'));

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId, isEditMode } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const { projectInfoPopup } = storeToRefs(uiStore);
const toast = useToast();
const { t } = useI18n();
const { isPublishing: isPublishingOverlay, publishOverlay } = useOverlayPublisher();
const { isPublishing: isPublishingProject, publishProject } = useProjectPublisher();

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

// AI : Get project for overlay - either from local projects store or overlay project data
function getProjectForOverlay(overlay: OverlayObject): Project | null {
  if (overlay.projectId) {
    // AI : First try to get from local projects store
    const localProject = projects.value[overlay.projectId];
    if (localProject) {
      return localProject;
    }

    // AI : If not found locally, check if this overlay has backend project data
    if (overlay.project?.id === overlay.projectId) {
      // AI : Convert backend project data to frontend format
      const backendProject = overlay.project;
      const convertedProject: Project = {
        ...backendProject,
        name: backendProject.name,
        city: backendProject.city,
        overlayIds: [],
        color: '#007bff',
        savedRemotely: true
      };

      // AI : Add the project to the projects store so other components can access it
      if (!projects.value[overlay.projectId]) {
        projects.value = {
          ...projects.value,
          [overlay.projectId]: convertedProject
        };
      }

      return convertedProject;
    }
  }
  return null;
}

// AI : Handle project change (overlay mode only)
async function handleProjectChange(projectId: string) {
  const overlay = overlayObject.value;
  if (!overlay) return;

  // AI : Update the overlay's project assignment
  overlay.projectId = projectId;
  overlay.isModified = true;

  // AI : Update tooltip text (updateTooltipText works on selected overlay)
  updateTooltipText();
}

// AI : Handle overlay publishing (overlay mode only)
async function handlePublishOverlay() {
  const overlay = overlayObject.value;
  if (!overlay) return;

  const project = getProjectForOverlay(overlay);

  try {
    await publishOverlay(overlay, project);
    toast.add({
      severity: 'success',
      summary: t('overlay.publishSuccess'),
      detail: t('overlay.publishSuccessDetail'),
      life: 3000
    });
  } catch (error) {
    console.error('Error publishing overlay:', error);
    toast.add({
      severity: 'error',
      summary: t('overlay.publishFailed'),
      detail: t('overlay.publishFailedDetail'),
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
  uiStore.openProjectDialog(project, 'edit');
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
}
</script>