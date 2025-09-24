<template>
  <Teleport to="#project-info-popup-teleport-target" v-if="shouldShowPopup">
    <ProjectInfoPopup
      :project="selectedProject"
      :viewMode="!isEditMode"
      :publishLoading="isPublishing"
      :loading="false"
      :availableCities="availableCities"
      @publish-project="handlePublishProject"
      @edit-project="handleEditProject"
      @close-popup="closeProjectInfoPopup"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useUiStore } from '@stores/uiStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import ProjectInfoPopup from './ProjectInfoPopup.vue';
import { useToast } from '@composables/ui/useToast';
import { citiesWithProjects, loadCityProjects, cleanupProjectInfoTeleportTarget } from '@composables/map/useCityMarkers';
import { trpc } from '@client';
import type { Project } from '@types';

const projectStore = useProjectStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();
const { projects } = storeToRefs(projectStore);
const { isEditMode } = storeToRefs(overlayStore);
const { projectInfoPopup } = storeToRefs(uiStore);
const toast = useToast();

// AI : Local state for publishing
const isPublishing = ref(false);

// AI : Computed for available cities
const availableCities = computed(() => {
  return citiesWithProjects.value.map(city => ({
    id: city.id,
    name: city.name,
    countryCode: city.countryCode
  }));
});

// AI : Track if teleport target exists - assume it exists since it's in MapView
const teleportTargetExists = ref(true);


// AI : Get the selected project
const selectedProject = computed(() => {
  if (!projectInfoPopup.value.projectId || !projects.value[projectInfoPopup.value.projectId]) {
    return null;
  }
  return projects.value[projectInfoPopup.value.projectId];
});

// AI : Computed for template condition
const shouldShowPopup = computed(() => {
  return projectInfoPopup.value.visible && selectedProject.value && teleportTargetExists.value;
});

// AI : Handle publish project to backend
async function handlePublishProject() {
  const project = selectedProject.value;
  if (!project || !project.isMarker) return;

  isPublishing.value = true;
  
  try {
    const publishResult = await trpc.project.publishProject.mutate({
      id: project.id,
      name: project.name!,
      description: project.description ?? undefined,
      isMarker: project.isMarker,
      lat: project.lat,
      lng: project.lng,
      cityId: project.cityId ?? undefined,
    });
    
    if (publishResult.success) {
      // AI : Mark project as saved remotely
      if (projects.value[project.id]) {
        projects.value[project.id] = {
          ...projects.value[project.id],
          savedRemotely: true
        };
      }
      
      toast.add({
        severity: 'success',
        summary: 'Project Published',
        detail: 'Marker project has been saved to the backend',
        life: 3000
      });
      
      // AI : Refresh city projects to show updated marker
      if (mapStore.selectedCity) {
        await loadCityProjects(mapStore.selectedCity.id, mapStore.selectedCity.name, true, mapStore.selectedCity.countryCode);
      } else {
        await loadCityProjects(null as any, '', true);
      }
    } else {
      throw new Error('Backend publish failed');
    }
  } catch (error) {
    console.error('Error publishing project:', error);
    toast.add({
      severity: 'error',
      summary: 'Publish Failed',
      detail: 'Failed to save project to backend',
      life: 3000
    });
  } finally {
    isPublishing.value = false;
  }
}

// AI : Handle edit project
function handleEditProject(project: Project) {
  // AI : Close the info popup first
  closeProjectInfoPopup();
  // AI : Open the project dialog for editing
  uiStore.openProjectDialog(project, 'edit');
}

// AI : Clean up teleport target when popup is closed
function closeProjectInfoPopup() {
  uiStore.closeProjectInfoPopup();
  
  // AI : Clean up teleport target and listeners
  cleanupProjectInfoTeleportTarget();
}
</script>

<style scoped>
/* AI : Hide any unwanted visual artifacts */
</style>