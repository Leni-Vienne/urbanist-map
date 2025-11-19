<template>
  <!-- AI : Project Selector Dialog -->
  <Dialog
    v-model:visible="uiStore.projectSelectorVisible"
    header="Select a nearby project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectPicker
      v-model="selectedProjectForUpload"
      @create-project="uiStore.openProjectDialog()"
      :useCityProjects="true"
      appendTo="body"
      ref="projectPickerRef"
    />

    <template #footer>
      <div class="flex gap-2 justify-end">
        <Button
          label="Cancel"
          severity="secondary"
          @click="uiStore.closeProjectSelector()"
        />
        <Button
          label="Confirm"
          :disabled="!selectedProjectForUpload"
          @click="onProjectConfirmed"
        />
      </div>
    </template>
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
    v-if="projectEditForm.visible"
    v-model:visible="projectEditForm.visible"
    :modal="true"
    :closable="true"
    :draggable="false"
    header="Suggest Project Changes"
    @update:visible="uiStore.closeProjectEditForm"
    class="edit-form-dialog"
  >
    <EditProjectForm
      v-if="projectEditForm.data"
      :project="(projectEditForm.data as Project)"
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
    <EditOverlayForm
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
    @update:visible="onDialogVisibilityChange"
  />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, watch } from 'vue'
import { storeToRefs } from 'pinia'
import L from 'leaflet'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { map } from '@composables/core/useMap'
import { loadCityProjects, getDevelopmentMarkerByProjectId, createProjectInfoTeleportTarget, updateDevelopmentMarkerColor, addSingleCityMarker, addCityMarkersForCountry } from '@composables/map/useCityMarkers'
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers'
import { addOverlay } from '@composables/overlay/useOverlay'
import { setLastCreatedProject } from '@composables/ui/useProjectState'
import { createProject } from '@composables/project/useProjects'
import { createProjectFromAPI, createProject as createProjectInstance } from '../../utils/typeFactories'
import { useCityProjects } from '@composables/project/useProjectSelection'
import type { Project, OverlayObject } from '@types'
import type { NearbyProject } from '../../types/api'

import ImageUploadDialog from '@components/map/ImageUploadDialog.vue'
import ProjectPicker from '@components/project/ProjectPicker.vue'
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'))
const EditProjectForm = defineAsyncComponent(() => import('@components/forms/EditProjectForm.vue'))
const EditOverlayForm = defineAsyncComponent(() => import('@components/forms/EditOverlayForm.vue'))

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
const { projectEditForm } = storeToRefs(uiStore)

// AI : Track selected project for upload (preselects original project for replacements)
const selectedProjectForUpload = ref<string>('')

// AI : Get the original overlay's project ID for replacements
function getOriginalOverlayProjectId(): string | null {
  if (!replacementOverlayId.value) return null;
  const originalOverlay = overlayStore.overlays[replacementOverlayId.value];
  return originalOverlay?.projectId ?? null;
}

// AI : Initialize selectedProjectForUpload when opening dialog for replacements
watch(() => uiStore.projectSelectorVisible, (visible: boolean) => {
  if (visible) {
    selectedProjectForUpload.value = getOriginalOverlayProjectId() ?? '';
  }
})

// AI : Handle project confirmation button click
function onProjectConfirmed() {
  if (selectedProjectForUpload.value) {
    onProjectSelected(selectedProjectForUpload.value);
  }
}

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : For replacement overlays, use the original overlay's project if no specific project selected
  const effectiveProjectId = (replacementOverlayId.value && !projectId)
    ? getOriginalOverlayProjectId()
    : projectId;

  if (!effectiveProjectId) {
    console.warn('No project ID available for overlay');
    return;
  }

  // AI : Check if project exists in local store, if not, try to get it from available sources
  if (!projects.value[effectiveProjectId]) {
    try {
      let projectToAdd: Project | null = null;

      // AI : For replacement overlays, try to get the project from the original overlay first
      if (replacementOverlayId.value) {
        const originalOverlay = overlayStore.overlays[replacementOverlayId.value];
        if (originalOverlay?.project?.id === effectiveProjectId) {
          projectToAdd = createProjectInstance({
            ...originalOverlay.project,
            description: originalOverlay.project.description ?? null,
            overlayIds: []
          });
        }
      }

      // AI : If not found in original overlay, get from city projects (includes city overlays + nearby projects)
      if (!projectToAdd) {
        const { projects: cityProjectsList } = useCityProjects();
        const cityProject = cityProjectsList.value.find((p: Project) => p.id === projectId);
        if (cityProject) {
          projectToAdd = cityProject;
        }
      }

      // AI : If still not found, try fetching fresh nearby projects as last resort
      if (!projectToAdd) {
        console.log('Fetching nearby projects to find project ID:', projectId);
        const nearbyProjects = await projectStore.fetchNearbyProjects();
        const nearbyProject = nearbyProjects.find((p: NearbyProject) => p.id === projectId);
        if (nearbyProject) {
          projectToAdd = createProjectFromAPI(nearbyProject);
        }
      }

      // AI : Add the project to local store if found
      if (projectToAdd) {
        // AI : Create new object reference to trigger shallowRef reactivity
        const updatedProjects = { ...projects.value };
        updatedProjects[projectId] = projectToAdd;
        projects.value = updatedProjects;
      } else {
        console.warn('Project not found in any source, overlay creation may not work properly');
      }
    } catch (error) {
      console.error('Error getting project for overlay:', error);
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
function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  if (tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }

  // AI : Open project dialog with coordinates - user must fill form before marker is created
  uiStore.openProjectDialog({
    isDevelopment: true,
    lat: coordinates.lat,
    lng: coordinates.lng
  }, 'create');
}


// AI : Handle marker mode enabled - setup map click listener
function onMarkerModeEnabled() {
  if (!map.value) return;

  // AI : Add temporary click listener for marker placement
  const handleMapClick = (e: L.LeafletMouseEvent) => {
    const coordinates = { lat: e.latlng.lat, lng: e.latlng.lng };

    // AI : Remove previous temp marker if exists
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
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

// AI : Handle dialog visibility changes to clean up temporary marker on close
function onDialogVisibilityChange(visible: boolean) {
  if (!visible && tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }
}

// AI : Handle project creation/update from dialog
async function handleProjectSubmitted(project: Partial<Project>) {
  if (!project) return;

  try {
    uiStore.closeProjectDialog()

    let projectId: string;

    if (!project.id) {
      // AI : Create the project and get the generated ID
      projectId = createProject(project)
      setLastCreatedProject(projectId)

      // AI : For development projects, load on map and show marker
      if (project.isDevelopment && project.city) {
        const countryCode = project.city.countryCode;

        // AI : Set selected city for proper map context
        mapStore.setSelectedCity({
          id: project.city.id,
          name: project.city.name,
          countryCode: countryCode
        });

        if (countryCode) {
          mapStore.selectedCountryCode = countryCode;

          // AI : Load city markers for the country (same pattern as overlays)
          addSingleCityMarker({
            id: project.city.id,
            name: project.city.name,
            lat: project.city.coordinates.y,
            lng: project.city.coordinates.x,
            countryCode: countryCode
          });

          await loadCitiesForCountry(countryCode);
          const country = projectStore.countries.find((c) => c.code === countryCode);
          if (country?.cities) {
            addCityMarkersForCountry(country.cities.map((c) => ({ ...c, projectCount: 0 })));

            // AI : Re-add single marker if city not in backend response
            const cityExistsInBackend = country.cities.some((c) => c.id === project.city!.id);
            if (!cityExistsInBackend) {
              addSingleCityMarker({
                id: project.city.id,
                name: project.city.name,
                lat: project.city.coordinates.y,
                lng: project.city.coordinates.x,
                countryCode: countryCode
              });
            }
          }
        }

        // AI : Load city projects to display the development marker
        await loadCityProjects(project.city.id, project.city.name, true, project.city.countryCode);

        // AI : Get the marker and open its popup
        const actualMarker = getDevelopmentMarkerByProjectId(projectId);
        if (actualMarker) {
          createProjectInfoTeleportTarget(actualMarker);
          uiStore.openProjectInfoPopup(projectId, projectStore.projects[projectId]);
        }

        toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Development project created successfully',
          life: 3000
        });
      }
    } else {
      // AI : Project already exists (edit mode), update the existing project data
      projectId = project.id;
      if (projects.value[project.id]) {
        // AI : Use updateProject to properly set isModified flag
        projectStore.updateProject(project.id, {
          ...project,
          // AI : Ensure we preserve important fields that might not be in the edit form
          overlayIds: projects.value[project.id].overlayIds || [],
          isModified: true
        });

        // AI : Update development marker color to reflect modification
        if (project.isDevelopment) {
          updateDevelopmentMarkerColor(project.id, projects.value[project.id]);
        }

        // AI : Just save locally for all projects (no auto-publishing)
        toast.add({
          severity: 'success',
          summary: 'Project Updated',
          detail: 'Project changes saved locally',
          life: 3000
        });
      }

      setLastCreatedProject(project.id);
    }

    // AI : If there's a pending image file, skip the project selector and directly proceed to file upload
    // AI : This provides a smoother UX when creating a project specifically for a new overlay
    if (pendingImageFile.value) {
      await onProjectSelected(projectId);
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
}

:deep(.edit-form-dialog .p-dialog-content) {
  padding: 0;
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
