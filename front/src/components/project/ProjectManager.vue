<template>
  <!-- AI : Project Selector Dialog -->
  <Dialog
    v-model:visible="uiStore.projectSelectorVisible"
    :header="$t('projectSelector.header')"
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
          :label="$t('common.cancel')"
          severity="secondary"
          @click="uiStore.closeProjectSelector()"
        />
        <Button
          :label="$t('common.confirm')"
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
    :title="uiStore.projectDialog.mode === 'create' ? $t('dialog.createNewProject') : $t('dialog.editProject')"
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
    :header="$t('projectSelector.suggestProjectChanges')"
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
    :header="$t('projectSelector.suggestOverlayChanges')"
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

  <!-- AI : Marker Placement Dialog -->
  <MarkerPlacementBar
    ref="markerPlacementBar"
    v-model:visible="uiStore.markerPlacementBarVisible"
    @marker-coordinates="onMarkerCoordinatesSelected"
    @marker-mode-enabled="onMarkerModeEnabled"
    @update:visible="onDialogVisibilityChange"
  />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import L from 'leaflet'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { map } from '@composables/core/useMap'
import { loadCityProjects, createProjectInfoTeleportTarget, updateStandaloneProjectMarkerColor, addSingleCityMarker, addCityMarkersForCountry } from '@composables/map/useCityMarkers'
import { getStandaloneProjectMarkerByProjectId } from '@composables/map/useStandaloneProjectMarkers'
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers'
import { useMapStore } from '@stores/pinia/mapStore'
import { createBasicProjectIcon } from '@composables/map/useMarkers'
import { addOverlay } from '@composables/overlay/useOverlay'
import { setLastCreatedProject } from '@composables/ui/useProjectState'
import { createProject } from '@composables/project/useProjects'
import { createProjectObjectFromAPI, createProjectObject } from '../../utils/typeFactories'
import { useCityProjects } from '@composables/project/useProjectSelection'
import type { Project, OverlayObject } from '@types'
import type { NearbyProject } from '../../types/api'

import MarkerPlacementBar from '@components/map/MarkerPlacementBar.vue'
import ProjectPicker from '@components/project/ProjectPicker.vue'
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'))
const EditProjectForm = defineAsyncComponent(() => import('@components/forms/EditProjectForm.vue'))
const EditOverlayForm = defineAsyncComponent(() => import('@components/forms/EditOverlayForm.vue'))

const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()
const uiStore = useUiStore()
const toast = useToast()
const { t: $t } = useI18n()
const projectPickerRef = ref()
const markerPlacementBar = ref()
const tempMarker = ref<L.Marker | null>(null)

const { projects } = storeToRefs(projectStore)
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore)
const { projectEditForm } = storeToRefs(uiStore)

// AI : Track selected project for upload (preselects original project for replacements)
const selectedProjectForUpload = ref<string>('')

// AI : Helper to ensure city markers are properly set up for a project's city
async function ensureCityMarkersForProject(
  city: { id: string; name: string; countryCode: string; coordinates: { x: number; y: number } },
  forceSetSelectedCity = false
): Promise<void> {
  const countryCode = city.countryCode;

  // AI : Set selectedCity if not already set (or if forced) to prevent overlay disappearance on zoom
  if (forceSetSelectedCity || !mapStore.selectedCity) {
    mapStore.setSelectedCity({
      id: city.id,
      name: city.name,
      countryCode: countryCode
    });
  }

  if (!countryCode) return;

  mapStore.selectedCountryCode = countryCode;

  // AI : First add single marker immediately (fast feedback)
  addSingleCityMarker({
    id: city.id,
    name: city.name,
    lat: city.coordinates.y,
    lng: city.coordinates.x,
    countryCode: countryCode
  });

  // AI : Then load all cities for the country
  await loadCitiesForCountry(countryCode);
  const country = projectStore.countries.find((c) => c.code === countryCode);

  if (country?.cities) {
    addCityMarkersForCountry(country.cities.map((c) => ({ ...c, projectCount: 0 })));

    // AI : Re-add single marker if city not in backend response (new city without approved projects)
    const cityExistsInBackend = country.cities.some((c) => c.id === city.id);
    if (!cityExistsInBackend) {
      addSingleCityMarker({
        id: city.id,
        name: city.name,
        lat: city.coordinates.y,
        lng: city.coordinates.x,
        countryCode: countryCode
      });
    }
  }
}

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
          projectToAdd = createProjectObject({
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
          projectToAdd = createProjectObjectFromAPI(nearbyProject);
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
      summary: $t('upload.noFileSelected'),
      detail: $t('upload.selectImageFile'),
      life: 3000
    })
    uiStore.closeProjectSelector()
    return
  }

  const reader = new FileReader()
  reader.onload = async () => {
    try {
      if (isReplacement && replacementOverlayId.value) {
        // AI : Create replacement overlay using the standard overlay creation process
        const overlayId = addOverlay(reader.result as string, projectId, replacementOverlayId.value)

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: $t('toasts.replacementOverlayCreated'),
            detail: $t('toasts.replacementOverlayDetail'),
            life: 3000
          })
        }
      } else {
        // AI : Regular overlay addition
        addOverlay(reader.result as string, projectId)
        // AI : Don't show toast here - addOverlayToProjectWithId will show a more specific toast
      }

      // AI : Ensure city markers exist for this overlay's city
      const project = projectStore.projects[projectId]
      if (project?.city) {
        await ensureCityMarkersForProject(project.city)
      }
    } catch (error) {
      console.error('Error handling file upload:', error)
      toast.add({
        severity: 'error',
        summary: $t('replacementOverlay.uploadFailed'),
        detail: $t('replacementOverlay.uploadFailedDetail'),
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

// AI : Handle marker coordinates selection from dialog
function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  if (tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }

  // AI : Open project dialog with coordinates - user must fill form before marker is created
  // AI : All projects now have center coordinates (no isStandalone field)
  uiStore.openProjectDialog({
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

    // AI : Create temporary marker using StandaloneProjectMarkerSVG in orange for visual feedback
    const markerIcon = createBasicProjectIcon('orange');
    tempMarker.value = L.marker([coordinates.lat, coordinates.lng], {
      icon: markerIcon,
      draggable: false,
    }).addTo(map.value!);

    // AI : Pass coordinates back to marker placement bar
    if (markerPlacementBar.value) {
      markerPlacementBar.value.setMarkerCoordinates(coordinates);
    }

    // AI : Keep listener active to allow repositioning - will be removed when dialog closes
  };

  map.value.on('click', handleMapClick);

  // AI : Store handler reference for cleanup
  (map.value as any)._tempMarkerClickHandler = handleMapClick;
}

// AI : Handle dialog visibility changes to clean up temporary marker and listener on close
function onDialogVisibilityChange(visible: boolean) {
  if (!visible) {
    // AI : Remove temporary marker
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
    }

    // AI : Remove click listener
    if (map.value && (map.value as any)._tempMarkerClickHandler) {
      map.value.off('click', (map.value as any)._tempMarkerClickHandler);
      (map.value as any)._tempMarkerClickHandler = null;
    }
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
      // AI : isModified: true ensures new projects show as orange in edit mode
      projectId = createProject({
        ...project,
        isModified: true,  // AI : New projects need to be submitted
        status: undefined  // AI : No status until submitted (prevents being treated as update)
      })
      setLastCreatedProject(projectId)

      // AI : For projects with center coordinates (no overlays), load on map and show marker
      const hasNoOverlays = !project.overlayIds || project.overlayIds.length === 0
      if (hasNoOverlays && project.lat && project.lng && project.city) {
        // AI : Ensure city markers are set up (force set selectedCity for proper map context)
        await ensureCityMarkersForProject(project.city, true);

        // AI : Load city projects to display the marker
        await loadCityProjects(project.city.id, project.city.name, true, project.city.countryCode);

        // AI : Get the marker and open its popup
        const actualMarker = getStandaloneProjectMarkerByProjectId(projectId);
        if (actualMarker) {
          createProjectInfoTeleportTarget(actualMarker);
          // AI : Close overlay popup if it's open (only one popup at a time)
          if (overlayStore.showInfoPopup) {
            overlayStore.hideInfoPopup();
          }
          uiStore.openProjectInfoPopup(projectId, projectStore.projects[projectId]);
        }

        toast.add({
          severity: 'success',
          summary: $t('common.success'),
          detail: $t('toasts.standaloneProjectSuccess'),
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

        // AI : Update marker color to reflect modification if project has no overlays
        const hasNoOverlays = !projects.value[project.id].overlayIds || projects.value[project.id].overlayIds.length === 0
        if (hasNoOverlays) {
          updateStandaloneProjectMarkerColor(project.id, projects.value[project.id]);
        }

        // AI : Just save locally for all projects (no auto-publishing)
        toast.add({
          severity: 'success',
          summary: $t('toasts.projectUpdateSuccess'),
          detail: $t('toasts.projectUpdateDetail'),
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
      summary: project.id ? $t('toasts.projectUpdateFailed') : $t('toasts.projectCreationFailed'),
      detail: project.id
        ? $t('toasts.projectUpdateFailedDetail')
        : $t('toasts.projectCreationFailedDetail'),
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

/* AI : Standalone project styles */
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
