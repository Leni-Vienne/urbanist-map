<template>
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
    :header="$t('projectSelector.suggestChanges')"
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
import { ref, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import L from 'leaflet'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { useToast } from '@/composables/ui/useToast'
import { map } from '@/composables/core/useMap'
import { loadCityProjects, updateStandaloneProjectMarkerColor, addSingleCityMarker, addCityMarkersForCountry } from '@/composables/map/useCityMarkers'
import { createProjectInfoTeleportTarget } from '@/composables/map/useProjectPopupTeleport'
import { getStandaloneProjectMarkerByProjectId } from '@/composables/map/useStandaloneProjectMarkers'
import { loadCitiesForCountry } from '@/composables/map/useCountryMarkers'
import { useMapStore } from '@/stores/pinia/mapStore'
import { createStandaloneProjectIcon } from '@/composables/map/useMarkers'
import { addOverlay } from '@/composables/overlay/useOverlay'
import { createProject } from '@/composables/project/useProjects'
import { createProjectObjectFromAPI, createProjectObject } from '../../utils/typeFactories'
import { useCityProjects } from '@/composables/project/useProjectSelection'
import type { Project } from '@/types/index'
import type { NearbyProject } from '../../types/api'

import MarkerPlacementBar from '@/components/map/MarkerPlacementBar.vue'
const ProjectDialog = defineAsyncComponent(() => import('@/components/project/ProjectDialog.vue'))
const EditProjectForm = defineAsyncComponent(() => import('@/components/forms/EditProjectForm.vue'))

const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const mapStore = useMapStore()
const uiStore = useUiStore()
const toast = useToast()
const { t: $t } = useI18n()
const markerPlacementBar = ref()
const tempMarker = ref<L.Marker | null>(null)

const { projects } = storeToRefs(projectStore)
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore)
const { projectEditForm } = storeToRefs(uiStore)

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

// AI : Try to find project from replacement overlay
function findProjectFromReplacementOverlay(projectId: string): Project | null {
  if (!replacementOverlayId.value) return null;

  const originalOverlay = overlayStore.overlays[replacementOverlayId.value];
  if (originalOverlay?.project?.id === projectId) {
    return createProjectObject({
      ...originalOverlay.project,
      description: originalOverlay.project.description ?? null,
      overlayIds: []
    });
  }

  return null;
}

// AI : Try to find project from city projects list
function findProjectFromCityProjects(projectId: string): Project | null {
  const { projects: cityProjectsList } = useCityProjects();
  const cityProject = cityProjectsList.value.find((p: Project) => p.id === projectId);
  return cityProject ?? null;
}

// AI : Try to find project by fetching nearby projects
async function findProjectFromNearbyProjects(projectId: string): Promise<Project | null> {
  if (!map.value) return null;

  console.log('Fetching nearby projects to find project ID:', projectId);
  const center = map.value.getCenter();
  const nearbyProjects = await projectStore.fetchNearbyProjects(center.lat, center.lng);
  const nearbyProject = nearbyProjects.find((p: NearbyProject) => p.id === projectId);

  return nearbyProject ? createProjectObjectFromAPI(nearbyProject) : null;
}

// AI : Add project to store with reactivity trigger
function addProjectToStore(projectId: string, project: Project): void {
  // AI : Create new object reference to trigger shallowRef reactivity
  const updatedProjects = { ...projects.value };
  updatedProjects[projectId] = project;
  projects.value = updatedProjects;
}

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  if (!projectId) {
    console.warn('No project ID available for overlay');
    return;
  }

  // AI : Check if project exists in local store, if not, try to get it from available sources
  if (!projects.value[projectId]) {
    try {
      // AI : Try multiple sources in order of preference
      let projectToAdd = findProjectFromReplacementOverlay(projectId)
        ?? findProjectFromCityProjects(projectId)
        ?? await findProjectFromNearbyProjects(projectId);

      if (projectToAdd) {
        addProjectToStore(projectId, projectToAdd);
      } else {
        console.warn('Project not found in any source, overlay creation may not work properly');
      }
    } catch (error) {
      console.error('Error getting project for overlay:', error);
    }
  }

  await handleFileUpload(projectId, Boolean(replacementOverlayId.value))
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement = false) {
  if (!pendingImageFile.value) {
    console.warn('No image file to upload')
    toast.add({
      severity: 'warn',
      summary: $t('upload.noFileSelected'),
      detail: $t('upload.selectImageFile'),
      life: 3000
    })
    return
  }

  const reader = new FileReader()
  reader.addEventListener('load', async () => {
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
    }
  })
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
  function handleMapClick(e: L.LeafletMouseEvent) {
    const coordinates = { lat: e.latlng.lat, lng: e.latlng.lng };

    // AI : Remove previous temp marker if exists
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
    }

    // AI : Create temporary marker using StandaloneProjectMarkerSVG in orange for visual feedback
    const markerIcon = createStandaloneProjectIcon('orange');
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

// AI : Display project marker on map and open its info popup
async function displayProjectMarkerAndPopup(projectId: string, city: { id: string; name: string; countryCode: string; coordinates: { x: number; y: number } }) {
  await ensureCityMarkersForProject(city, true);
  await loadCityProjects(city.id, city.name, true, city.countryCode);

  const actualMarker = getStandaloneProjectMarkerByProjectId(projectId);
  if (actualMarker) {
    createProjectInfoTeleportTarget(actualMarker);
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }
    uiStore.openProjectInfoPopup(projectId, projectStore.projects[projectId]);
  }
}

// AI : Handle new project creation
async function handleNewProjectCreation(project: Partial<Project>): Promise<string> {
  const projectId = createProject({
    ...project,
    isModified: true,
  })
  uiStore.setLastCreatedProject(projectId)

  const hasNoOverlays = !project.overlayIds || project.overlayIds.length === 0
  if (hasNoOverlays && project.lat && project.lng && project.city) {
    await displayProjectMarkerAndPopup(projectId, project.city);
    toast.add({
      severity: 'success',
      summary: $t('common.success'),
      detail: $t('toasts.standaloneProjectSuccess'),
      life: 3000
    });
  }

  return projectId
}

// AI : Handle existing project update
function handleProjectUpdate(project: Partial<Project>): string {
  const projectId = project.id!;

  if (projects.value[projectId]) {
    projectStore.updateProject(projectId, {
      ...project,
      overlayIds: projects.value[projectId].overlayIds || [],
      isModified: true
    });

    const hasNoOverlays = !projects.value[projectId].overlayIds || projects.value[projectId].overlayIds.length === 0
    if (hasNoOverlays) {
      updateStandaloneProjectMarkerColor(projectId, projects.value[projectId]);
    }

    toast.add({
      severity: 'success',
      summary: $t('toasts.projectUpdateSuccess'),
      detail: $t('toasts.projectUpdateDetail'),
      life: 3000
    });
  }

  uiStore.setLastCreatedProject(projectId);
  return projectId
}

// AI : Handle project creation/update from dialog
async function handleProjectSubmitted(project: Partial<Project>) {
  if (!project) return;

  try {
    uiStore.closeProjectDialog()

    const projectId = project.id
      ? handleProjectUpdate(project)
      : await handleNewProjectCreation(project);

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
