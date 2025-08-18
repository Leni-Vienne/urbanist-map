<template>
  <Teleport to="#info-popup-teleport-target" v-if="showInfoPopup && overlayObject && teleportTargetExists">
    <InfoPopup
      :overlayObject="overlayObject"
      :project="getProjectForOverlay(overlayObject)"
      :viewMode="!isEditMode"
      :publishLoading="isPublishing"
      :loading="false"
      :availableCities="availableCities"
      @project-change="handleProjectChange"
      @publish-overlay="handlePublishOverlay"
      @edit-project="handleEditProject"
      @edit-overlay="handleEditOverlay"
      @overlay-update="handleOverlayUpdate"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useUiStore } from '@stores/uiStore';
import InfoPopup from './InfoPopup.vue';
import { updateTooltipText } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects';
import { useOverlayPublisher } from '@composables/overlay/useOverlayPublisher';
import { citiesWithProjects } from '@composables/map/useCityMarkers';
import type { OverlayObject, Project } from '@types';

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const { overlays, showInfoPopup, infoPopupOverlayId, isEditMode, replacementOverlayId } = storeToRefs(overlayStore);
const { projects } = storeToRefs(projectStore);
const toast = useToast();
const { isPublishing, publishOverlay } = useOverlayPublisher();

// AI : Computed for available cities
const availableCities = computed(() => {
  return citiesWithProjects.value.map(city => ({
    id: city.id,
    name: city.name,
    countryCode: city.countryCode
  }));
});

// AI : Track if teleport target exists
const teleportTargetExists = ref(false);

// AI : Check for teleport target existence
function checkTeleportTarget() {
  teleportTargetExists.value = !!document.querySelector('#info-popup-teleport-target');
}

// AI : Set up a watcher for teleport target
let targetObserver: MutationObserver | null = null;

onMounted(() => {
  checkTeleportTarget();
  
  // AI : Watch for DOM changes to detect when teleport target is added/removed
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
    if (overlay.project && overlay.project.id === overlay.projectId) {
      // AI : Convert backend project data to frontend format
      const backendProject = overlay.project;
      const convertedProject: Project = {
        ...backendProject,
        name: backendProject.name,
        city: backendProject.city as any,
        overlayIds: [],
        color: '#007bff'
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

// AI : Handle project change
async function handleProjectChange(projectId: string) {
  const overlay = overlayObject.value;
  if (!overlay) return;

  try {
    const originalProjectId = overlay.projectId;

    // AI : If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await projectStore.removeOverlayFromProjectWithId(originalProjectId, overlay.id);
    }

    // AI : Check if project exists in local store, if not, try to get it from nearby projects
    if (!projects.value[projectId]) {
      const nearbyProjects = await fetchNearbyProjects();
      const nearbyProject = nearbyProjects.find((p: any) => p.id === projectId);

      if (nearbyProject) {
        // AI : Convert nearby project to local project format and add to store
        const localProject = {
          id: nearbyProject.id,
          name: nearbyProject.name,
          description: nearbyProject.description ?? '',
          overlayIds: [],
          color: '#007bff',
          cityId: nearbyProject.cityId,
          status: 'approved' as const,
          ownerId: nearbyProject.ownerId,
          createdAt: nearbyProject.createdAt,
          updatedAt: nearbyProject.updatedAt,
          metadata: nearbyProject.metadata,
          city: nearbyProject.city ? {
            id: nearbyProject.city.id,
            name: nearbyProject.city.name,
            countryCode: nearbyProject.city.countryCode,
            coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
            createdAt: null,
            updatedAt: new Date()
          } : undefined,
          sourceUrl: null,
          startDate: null,
          endDate: null,
          latestUpdateOn: null,
          savedRemotely: true
        };

        // AI : Add project to local store
        projects.value[projectId] = localProject;

        // AI : Also set project data on overlay object for InfoPopup display
        overlay.project = {
          id: nearbyProject.id,
          status: 'approved' as const,
          name: nearbyProject.name,
          description: nearbyProject.description ?? null,
          createdAt: nearbyProject.createdAt,
          updatedAt: nearbyProject.updatedAt,
          ownerId: nearbyProject.ownerId,
          cityId: nearbyProject.cityId,
          startDate: null,
          endDate: null,
          sourceUrl: null,
          latestUpdateOn: null,
          metadata: nearbyProject.metadata,
          city: nearbyProject.city ? {
            id: nearbyProject.city.id,
            name: nearbyProject.city.name,
            countryCode: nearbyProject.city.countryCode,
            coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
            createdAt: null,
            updatedAt: new Date()
          } : null
        };
      } else {
        throw new Error(`Project ${projectId} not found in local store or nearby projects`);
      }
    }

    // AI : Add to the new project
    await projectStore.addOverlayToProjectWithId(projectId, overlay.id);

    // AI : Update overlay's project reference
    overlay.projectId = projectId;

    // AI : Force reactivity update
    await nextTick();

    toast.add({
      severity: 'success',
      summary: 'Project Updated',
      detail: 'Overlay assigned to project successfully',
      life: 3000
    });

    // AI : Update the tooltip text
    updateTooltipText();
  } catch (error) {
    console.error('AI : Failed to assign overlay to project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to assign overlay to project',
      life: 3000
    });
  }
}

// AI : Handle publish overlay
function handlePublishOverlay() {
  const overlay = overlayObject.value;
  const proj = overlay ? getProjectForOverlay(overlay) : null;
  if (overlay && proj) {
    publishOverlay(overlay, proj);
  }
}

// AI : Handle overlay update
function handleOverlayUpdate(overlayId: string, caption?: string) {
  // AI : Update the overlay caption in the overlays store
  const overlay = overlays.value[overlayId];
  if (overlay) {
    overlay.caption = caption ?? null;
  }
}

// AI : Handle edit project
function handleEditProject(project: Project) {
  uiStore.openProjectEditForm(project);
}

// AI : Handle edit overlay
function handleEditOverlay(overlay: OverlayObject) {
  uiStore.openOverlayEditForm(overlay);
}
</script>

<style scoped>
/* AI : Make the subtoolbar button invisible and non-clickable */
:deep(.leaflet-toolbar-icon.more-info-popup:not(#info-popup-teleport-target)) {
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  z-index: -1 !important;
}
</style>
