<template>
  <!-- AI : Project Selector Dialog -->
  <Dialog
    v-model:visible="uiStore.projectSelectorVisible"
    header="Select a nearby project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectPicker
      @project-selected="onProjectSelected"
      @create-project="uiStore.openProjectDialog()"
      @select-focus="fetchProjectsForPicker"
      :useCityProjects="true"
      ref="projectPickerRef"
    />
  </Dialog>

  <!-- AI : Project Dialog for create/edit -->
  <ProjectDialog
    v-if="uiStore.projectDialog.visible"
    v-model:visible="uiStore.projectDialog.visible"
    :project="uiStore.projectDialog.project ?? {}"
    :mode="uiStore.projectDialog.mode"
    :title="uiStore.projectDialog.mode === 'create' ? 'Create New Project' : 'Edit Project'"
    @submit="handleProjectSubmitted"
    @cancel="uiStore.closeProjectDialog"
  />

  <!-- AI : Project Edit Form Dialog -->
  <Dialog
    v-model:visible="uiStore.projectEditForm.visible"
    :modal="true"
    :closable="true"
    :draggable="false"
    header="Suggest Project Changes"
    @update:visible="uiStore.closeProjectEditForm"
    class="edit-form-dialog"
  >
    <EditableProjectForm
      v-if="uiStore.projectEditForm.data && uiStore.projectEditForm.visible"
      :project="(uiStore.projectEditForm.data as Project)"
      @close="uiStore.closeProjectEditForm"
      @submitted="uiStore.closeProjectEditForm"
    />
  </Dialog>

  <!-- AI : Overlay Edit Form Dialog -->
  <Dialog
    v-model:visible="uiStore.overlayEditForm.visible"
    :modal="true"
    :closable="true"
    :draggable="false"
    header="Suggest Overlay Changes"
    @update:visible="uiStore.closeOverlayEditForm"
    class="edit-form-dialog"
  >
    <EditableOverlayForm
      v-if="uiStore.overlayEditForm.data && uiStore.overlayEditForm.visible"
      :overlay="(uiStore.overlayEditForm.data as OverlayObject)"
      @close="uiStore.closeOverlayEditForm"
      @submitted="uiStore.closeOverlayEditForm"
    />
  </Dialog>

  <!-- AI : Image Upload Dialog -->
  <ImageUploadDialog
    ref="imageUploadDialog"
    v-model:visible="uiStore.imageUploadDialogVisible"
    @file-selected="onImageUploadFromDialog"
    @marker-coordinates="onMarkerCoordinatesSelected"
    @marker-mode-enabled="onMarkerModeEnabled"
  />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import L from 'leaflet'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { map } from '@composables/core/useMap'
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects'
import { loadCityProjects } from '@composables/map/useCityMarkers'
import { addOverlay } from '@composables/overlay/useOverlay'
import { setLastCreatedProject } from '@composables/ui/useProjectState'
import { createProject } from '@composables/project/useProjects'
import { createProjectFromAPI } from '../../utils/typeFactories'
import type { Project, OverlayObject } from '@types'
import type { NearbyProject } from '../../types/api'

import ImageUploadDialog from '@components/map/ImageUploadDialog.vue'
import ProjectPicker from '@components/project/ProjectPicker.vue'
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'))
const EditableProjectForm = defineAsyncComponent(() => import('@components/forms/EditableProjectForm.vue'))
const EditableOverlayForm = defineAsyncComponent(() => import('@components/forms/EditableOverlayForm.vue'))

const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()
const uiStore = useUiStore()
const toast = useToast()
const projectPickerRef = ref()
const imageUploadDialog = ref()
const tempMarker = ref<L.Marker | null>(null)

const { projects } = storeToRefs(projectStore)
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore)

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : Check if project exists in local store, if not, try to get it from nearby projects
  if (!projects.value[projectId]) {
    try {
      // AI : Fetch nearby projects to get the selected project data
      const nearbyProjects = await fetchNearbyProjects()
      const nearbyProject = nearbyProjects.find((p: NearbyProject) => p.id === projectId)

      if (nearbyProject) {
        // AI : Convert nearby project to local project format using factory function
        const localProject = createProjectFromAPI(nearbyProject)

        // AI : Add project to local store
        projects.value[projectId] = localProject
      } else {
        console.warn('AI : Project not found in nearby projects, overlay creation may not work properly')
      }
    } catch (error) {
      console.error('AI : Error fetching nearby projects for project selection:', error)
    }
  }

  await handleFileUpload(projectId, !!replacementOverlayId.value)
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement: boolean = false) {
  if (!pendingImageFile.value) {
    console.warn('No image file to upload')
    toast.add({
      severity: 'warn',
      summary: 'No file selected',
      detail: 'Please select an image file to upload',
      life: 3000
    })
    uiStore.closeProjectSelector()
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    try {
      if (isReplacement && replacementOverlayId.value) {
        // AI : Create replacement overlay using the standard overlay creation process
        const overlayId = addOverlay(reader.result as string, projectId, replacementOverlayId.value)

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: 'Replacement Overlay Created',
            detail: 'Your replacement overlay has been created and is ready for editing',
            life: 3000
          })
        }
      } else {
        // AI : Regular overlay addition
        addOverlay(reader.result as string, projectId)
        // AI : Don't show toast here - addOverlayToProjectWithId will show a more specific toast
      }
    } catch (error) {
      console.error('Error handling file upload:', error)
      toast.add({
        severity: 'error',
        summary: 'Upload Failed',
        detail: 'Failed to process the image overlay',
        life: 3000
      })
    } finally {
      // AI : Reset state
      overlayStore.resetReplacement()
      uiStore.closeProjectSelector()
    }
  }
  reader.readAsDataURL(pendingImageFile.value)
}

// AI : Handle file selection from dialog
async function onImageUploadFromDialog(file: File) {
  overlayStore.handleFileSelected(file)
  // AI : Show project selector for overlay workflow
  uiStore.openProjectSelector()
}

// AI : Handle marker coordinates selection from dialog
async function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  try {
    // AI : Create development project locally (user can edit details before publishing)
    const projectData = {
      name: 'Development Marker', // AI : Default name, user can edit later
      description: '',
      isMarker: true,
      lat: coordinates.lat,
      lng: coordinates.lng,
      cityId: mapStore.selectedCity?.id, // AI : Use currently selected city if available
    };
    
    
    const projectId = createProject(projectData);
    
    // AI : Clean up temporary marker
    if (tempMarker.value && map.value) {
      map.value.removeLayer(tempMarker.value as unknown as L.Layer);
      tempMarker.value = null;
    }
    
    toast.add({ 
      severity: 'success', 
      summary: 'Success', 
      detail: 'Development project created successfully',
      life: 3000
    });
    setLastCreatedProject(projectId);
    
    // AI : Small delay to ensure project is stored
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // AI : Always try to refresh city projects first
    if (mapStore.selectedCity) {
      await loadCityProjects(mapStore.selectedCity.id, mapStore.selectedCity.name, true, mapStore.selectedCity.countryCode);
    } else {
      // AI : If no city is selected, force load for null cityId to include local projects
      await loadCityProjects(null, '', true);
    }
  } catch (error) {
    console.error('Error creating development project:', error);
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to create development project' ,
      life: 3000
    });
  }
}


// AI : Handle marker mode enabled - setup map click listener
function onMarkerModeEnabled() {
  if (!map.value) return;
  
  // AI : Add temporary click listener for marker placement
  const handleMapClick = (e: L.LeafletMouseEvent) => {
    const coordinates = { lat: e.latlng.lat, lng: e.latlng.lng };
    
    // AI : Remove previous temp marker if exists
    if (tempMarker.value && map.value) {
      map.value.removeLayer(tempMarker.value as unknown as L.Layer);
    }
    
    // AI : Create temporary marker for visual feedback
    tempMarker.value = L.marker([coordinates.lat, coordinates.lng], {
      icon: L.divIcon({
        html: '<i class="pi pi-home" style="color: #3b82f6; font-size: 16px;"></i>',
        iconSize: [20, 20],
        className: 'temp-marker-icon'
      })
    }).addTo(map.value!);
    
    // AI : Pass coordinates back to dialog
    if (imageUploadDialog.value) {
      imageUploadDialog.value.setMarkerCoordinates(coordinates);
    }
    
    // AI : Remove listener after first click
    map.value?.off('click', handleMapClick);
  };
  
  map.value.on('click', handleMapClick);
}

// AI : Fetch projects for picker when dropdown is focused
async function fetchProjectsForPicker() {
  try {
    // AI : Fetch nearby projects based on current map view
    await fetchNearbyProjects()
  } catch (error) {
    console.error('Error fetching projects for picker:', error)
  }
}

// AI : Handle project creation/update from dialog
async function handleProjectSubmitted(project: Partial<Project>) {
  if (!project) return;

  try {
    uiStore.closeProjectDialog()

    if (!project.id) {
      // AI : Create the project and get the generated ID
      const projectId = createProject(project)
      setLastCreatedProject(projectId)
    } else {
      // AI : Project already exists (edit mode), update the existing project data
      if (projects.value[project.id]) {
        // AI : Update the existing project in the store with proper merge
        projects.value[project.id] = {
          ...projects.value[project.id],
          ...project,
          // AI : Ensure we preserve important fields that might not be in the edit form
          id: project.id,
          overlayIds: projects.value[project.id].overlayIds || [],
          color: projects.value[project.id].color || '#007bff'
        };

        // AI : Just save locally for all projects (no auto-publishing)
        toast.add({
          severity: 'success',
          summary: 'Project Updated',
          detail: 'Project changes saved locally',
          life: 3000
        });

        // AI : Refresh city projects to show updated marker on map
        if (project.isMarker && mapStore.selectedCity) {
          await loadCityProjects(mapStore.selectedCity.id, mapStore.selectedCity.name, true, mapStore.selectedCity.countryCode);
        } else if (project.isMarker) {
          // AI : Refresh for local projects if no city is selected
          await loadCityProjects(null, '', true);
        }
      }

      setLastCreatedProject(project.id);
    }

    // AI : Re-open the project selector so the ProjectPicker can auto-select the new project
    // AI : and continue with the file upload workflow
    if (pendingImageFile.value) {
      uiStore.openProjectSelector();
    }
  } catch (error) {
    console.error('Error with project:', error);
    toast.add({
      severity: 'error',
      summary: project.id ? 'Update Failed' : 'Project Creation Failed',
      detail: project.id
        ? 'Failed to save project changes'
        : 'Failed to create the project. Please try again.',
      life: 3000
    });
  }
}
</script>

<style scoped>
/* AI : Edit form dialogs - ensure proper modal behavior */
:deep(.edit-form-dialog .p-dialog) {
  max-width: 90vw;
  max-height: 90vh;
  z-index: 9999;
}

:deep(.edit-form-dialog .p-dialog-content) {
  padding: 0;
}

:deep(.edit-form-dialog .p-dialog-mask) {
  z-index: 9998;
}

/* AI : Temporary marker styles */
:global(.temp-marker-icon) {
  background: transparent !important;
  border: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

/* AI : Development project styles */
:global(.marker-project-icon) {
  background: transparent !important;
  border: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
}

:global(.marker-project-icon:hover) {
  transform: scale(1.1) !important;
}
</style>
