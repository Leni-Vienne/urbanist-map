<template>
  <!-- Project Dialog for create/edit -->
  <CreateProjectDialog
    v-if="uiStore.projectDialog.visible"
    v-model:visible="uiStore.projectDialog.visible"
    :project="uiStore.projectDialog.project ?? {}"
    @submit="handleProjectSubmitted"
    @cancel="uiStore.closeProjectDialog"
  />

  <!-- Project Edit Form Dialog -->
  <Dialog
    v-if="projectEditForm.visible"
    v-model:visible="projectEditForm.visible"
    :modal="true"
    :closable="true"
    :draggable="false"
    :header="$t('projectSelector.suggestChanges')"
    @update:visible="uiStore.closeProjectEditForm"
    :pt="{ root: { class: 'max-w-[90vw]' }, content: { class: '!p-0' } }"
  >
    <EditProjectForm
      v-if="projectEditForm.data"
      :project="projectEditForm.data as Project"
      @close="uiStore.closeProjectEditForm"
      @submitted="uiStore.closeProjectEditForm"
    />
  </Dialog>

  <!-- Marker Placement Dialog -->
  <MarkerPlacementBar
    ref="markerPlacementBar"
    v-model:visible="uiStore.markerPlacementBarVisible"
    @marker-coordinates="onMarkerCoordinatesSelected"
    @marker-mode-enabled="onMarkerModeEnabled"
    @update:visible="onDialogVisibilityChange"
  />
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/services/core/map";
import { createProjectInfoTeleportTarget } from "@/services/map/projectPopupTeleport";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
  updateStandaloneProjectMarkerColor,
} from "@/services/map/standaloneProjectMarkers";
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { useMapStore } from "@/stores/pinia/mapStore";
import { createStandaloneProjectIcon } from "@/services/map/markers";
import { createProject } from "@/services/project/projectMutations";
import { loadAndRenderCityData } from "@/services/navigation/cityNavigationTriggers";
import { createProjectObject } from "@/utils/typeFactories";
import { getCityProjects } from "@/services/project/projectSelection";
import type { Project } from "@/types/index";
import {
  addSingleCityMarker,
  addCityMarkersForCountry,
  citiesWithProjects,
} from "@/services/map/cityMarkers";

import MarkerPlacementBar from "@/components/map/MarkerPlacementBar.vue";
const CreateProjectDialog = defineAsyncComponent(
  () => import("@/components/project/CreateProjectDialog.vue"),
);
const EditProjectForm = defineAsyncComponent(
  () => import("@/components/forms/EditProjectForm.vue"),
);

const overlayStore = useOverlayStore();
const projectStore = useProjectStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const toast = useToast();
const { t: $t } = useI18n();
const markerPlacementBar = ref();
const tempMarker = ref<L.Marker | null>(null);

const { projects } = storeToRefs(projectStore);
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore);
const { projectEditForm } = storeToRefs(uiStore);

// Helper to ensure city markers are properly set up for a project's city
async function ensureCityMarkersForProject(
  city: {
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
    coordinates: { x: number; y: number };
  },
  forceSetSelectedCity = false,
): Promise<void> {
  const countryCode = city.countryCode;

  if (!countryCode) return;

  // Check if we're switching to a different country
  const isCountrySwitch = mapStore.selectedCountryCode !== countryCode;

  if (isCountrySwitch) {
    // Clear old map content only if we are actually switching from another country
    // If selectedCountryCode is null (neutral state), don't wipe potentially visible viewport content
    if (mapStore.selectedCountryCode) {
      clearAllMapContent();
    }
    mapStore.selectedCountryCode = countryCode;
    await loadCitiesForCountry(countryCode);
  }

  // Set selectedCity if not already set (or if forced) to prevent overlay disappearance on zoom
  if (forceSetSelectedCity || !mapStore.selectedCity) {
    mapStore.setSelectedCity({
      id: city.id,
      name: city.name,
      nameLocal: city.nameLocal,
      countryCode: countryCode,
    });
  }

  mapStore.selectedCountryCode = countryCode;

  // If not a country switch, add the single city marker for immediate feedback
  // (prepareCountryContext already adds markers, so only do this if we didn't switch countries)
  if (!isCountrySwitch) {
    // First add single marker immediately (fast feedback) - mark as unsaved
    await addSingleCityMarker(
      {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        lat: city.coordinates.y,
        lng: city.coordinates.x,
        countryCode: countryCode,
      },
      true,
    );

    // Then load all cities for the country (unsaved marker will be preserved)
    await loadCitiesForCountry(countryCode);
    const country = projectStore.countries.find((c) => c.code === countryCode);

    if (country?.cities) {
      addCityMarkersForCountry(
        country.cities.map((c) => Object.assign({}, c, { projectCount: 0 })),
      );
    }
  } else {
    // After country switch, add the unsaved city marker if it's not in the backend
    const country = projectStore.countries.find((c) => c.code === countryCode);
    const cityExistsInBackend = country?.cities.some((c) => c.id === city.id);
    if (!cityExistsInBackend) {
      await addSingleCityMarker(
        {
          id: city.id,
          name: city.name,
          nameLocal: city.nameLocal,
          lat: city.coordinates.y,
          lng: city.coordinates.x,
          countryCode: countryCode,
        },
        true,
      );
    }
  }
}

// Try to find project from replacement overlay
function findProjectFromReplacementOverlay(projectId: string): Project | null {
  if (!replacementOverlayId.value) return null;

  const originalOverlay = overlayStore.overlays[replacementOverlayId.value];
  if (originalOverlay?.project?.id === projectId) {
    return createProjectObject({
      ...originalOverlay.project,
      description: originalOverlay.project.description ?? null,
      overlayIds: [],
      geometry: originalOverlay.project.geometry ?? null,
    });
  }

  return null;
}

// Try to find project from city projects list
function findProjectFromCityProjects(projectId: string): Project | null {
  const { projects: cityProjectsList } = getCityProjects();
  const cityProject = cityProjectsList.value.find((p: Project) => p.id === projectId);
  return cityProject ?? null;
}

function addProjectToStore(projectId: string, project: Project): void {
  projects.value[projectId] = project;
}

// Process image after project selection
async function onProjectSelected(projectId: string) {
  if (!projectId) {
    console.warn("No project ID available for overlay");
    return;
  }

  // Check if project exists in local store, if not, try to get it from available sources
  if (!projects.value[projectId]) {
    try {
      // Try multiple sources in order of preference
      const projectToAdd =
        findProjectFromReplacementOverlay(projectId) ?? findProjectFromCityProjects(projectId);

      if (projectToAdd) {
        addProjectToStore(projectId, projectToAdd);
      } else {
        console.warn("Project not found in any source, overlay creation may not work properly");
      }
    } catch (error) {
      console.error("Error getting project for overlay:", error);
    }
  }

  await handleFileUpload(projectId, Boolean(replacementOverlayId.value));
}

// Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement = false) {
  if (!pendingImageFile.value) {
    console.warn("No image file to upload");
    toast.add({
      severity: "warn",
      summary: $t("upload.noFileSelected"),
      detail: $t("upload.selectImageFile"),
      life: 3000,
    });
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const { addOverlay } = await import("@/services/overlay/overlayEditing");
      if (isReplacement && replacementOverlayId.value) {
        // Create replacement overlay using the standard overlay creation process
        const overlayId = addOverlay(
          reader.result as string,
          projectId,
          replacementOverlayId.value,
        );

        if (overlayId) {
          toast.add({
            severity: "success",
            summary: $t("toasts.replacementOverlayCreated"),
            detail: $t("toasts.replacementOverlayDetail"),
            life: 3000,
          });
        }
      } else {
        // Regular overlay addition
        addOverlay(reader.result as string, projectId);
      }

      // Ensure city markers exist for this overlay's city
      const project = projectStore.projects[projectId];
      if (project?.city) {
        await ensureCityMarkersForProject(project.city);
      }
    } catch (error) {
      console.error("Error handling file upload:", error);
      toast.add({
        severity: "error",
        summary: $t("replacementOverlay.uploadFailed"),
        detail: $t("replacementOverlay.uploadFailedDetail"),
        life: 3000,
      });
    } finally {
      // Reset state
      overlayStore.resetReplacement();
    }
  });
  reader.readAsDataURL(pendingImageFile.value);
}

// Handle marker coordinates selection from dialog
function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  if (tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }

  // Open project dialog with coordinates - user must fill form before marker is created
  // All projects now have center coordinates (no isStandalone field)
  uiStore.openProjectDialog({
    lat: coordinates.lat,
    lng: coordinates.lng,
  });
}

// Handle marker mode enabled - setup map click listener
function onMarkerModeEnabled() {
  // Add temporary click listener for marker placement
  function handleMapClick(e: L.LeafletMouseEvent) {
    const coordinates = { lat: e.latlng.lat, lng: e.latlng.lng };

    // Remove previous temp marker if exists
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
    }

    // Create temporary marker using StandaloneProjectMarkerSVG in orange for visual feedback
    const markerIcon = createStandaloneProjectIcon("orange");
    const mapValue = map.value;
    if (!mapValue) return;

    tempMarker.value = L.marker([coordinates.lat, coordinates.lng], {
      icon: markerIcon,
      draggable: false,
    }).addTo(mapValue);

    // Pass coordinates back to marker placement bar
    if (markerPlacementBar.value) {
      markerPlacementBar.value.setMarkerCoordinates(coordinates);
    }
  }

  map.value.on("click", handleMapClick);

  // Store handler reference for cleanup
  (map.value as any)._tempMarkerClickHandler = handleMapClick;
}

// Handle dialog visibility changes to clean up temporary marker and listener on close
function onDialogVisibilityChange(visible: boolean) {
  if (!visible) {
    // Remove temporary marker
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
    }

    // Remove click listener
    if ((map.value as any)._tempMarkerClickHandler) {
      map.value.off("click", (map.value as any)._tempMarkerClickHandler);
      (map.value as any)._tempMarkerClickHandler = null;
    }
  }
}

// Display project marker on map and open its info popup
async function displayProjectMarkerAndPopup(
  projectId: string,
  city: {
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
    coordinates: { x: number; y: number };
  },
) {
  await ensureCityMarkersForProject(city, true);

  // Load city data to mark it as active in loadedCityIds
  // This ensures the city's content persists when zooming out (active city preservation)
  await loadAndRenderCityData(city.id, true);

  let actualMarker = getStandaloneProjectMarkerByProjectId(projectId);

  if (!actualMarker) {
    // Fallback: If marker wasn't created by viewport refresh (e.g. no camera move), create it manually
    const project = projectStore.projects[projectId];
    if (project) {
      addStandaloneProjectMarkerForProject(project);
      actualMarker = getStandaloneProjectMarkerByProjectId(projectId);
    }
  }

  if (actualMarker) {
    createProjectInfoTeleportTarget(actualMarker);
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }
    uiStore.openProjectInfoPopup(projectId, projectStore.projects[projectId]);

    // Zoom to the marker position to show the newly created project
    const project = projectStore.projects[projectId];
    if (project?.lat && project?.lng) {
      const currentZoom = map.value.getZoom();
      // Zoom to 16 if current zoom is less, otherwise keep current zoom
      const targetZoom = Math.max(currentZoom, 16);
      map.value.setView([project.lat, project.lng], targetZoom, {
        animate: true,
        duration: 1,
      });
    }
  }
}

// Handle new project creation
async function handleNewProjectCreation(project: Partial<Project>): Promise<string> {
  const projectId = createProject({
    ...project,
    isModified: true,
  });

  // CRITICAL FIX: Add city to citiesWithProjects so viewport manager knows to load it
  // This ensures standalone markers reappear after zoom out/in cycle
  if (project.city && project.cityId) {
    const cityExists = citiesWithProjects.value.some((c) => c.id === project.cityId);

    if (!cityExists) {
      citiesWithProjects.value = [
        ...citiesWithProjects.value,
        {
          id: project.cityId,
          name: project.city.name,
          nameLocal: project.city.nameLocal ?? null,
          lat: project.city.coordinates.y,
          lng: project.city.coordinates.x,
          countryCode: project.city.countryCode,
          projectCount: 0,
        },
      ];
    }
  }

  const hasNoOverlays = !project.overlayIds || project.overlayIds.length === 0;
  if (hasNoOverlays && project.lat && project.lng && project.city) {
    await displayProjectMarkerAndPopup(projectId, project.city);
    toast.add({
      severity: "success",
      summary: $t("common.success"),
      detail: $t("toasts.standaloneProjectSuccess"),
      life: 3000,
    });
  }

  return projectId;
}

// Handle existing project update
function handleProjectUpdate(project: Partial<Project>): string {
  const projectId = project.id;
  if (!projectId) {
    console.warn("Project ID is undefined in handleProjectUpdate");
    return "";
  }

  if (projects.value[projectId]) {
    projectStore.updateProject(projectId, {
      ...project,
      overlayIds: projects.value[projectId].overlayIds || [],
      isModified: true,
    });

    const hasNoOverlays =
      !projects.value[projectId].overlayIds || projects.value[projectId].overlayIds.length === 0;
    if (hasNoOverlays) {
      updateStandaloneProjectMarkerColor(projectId, projects.value[projectId]);
    }

    toast.add({
      severity: "success",
      summary: $t("toasts.projectUpdateSuccess"),
      detail: $t("toasts.projectUpdateDetail"),
      life: 3000,
    });
  }
  return projectId;
}

// Handle project creation/update from dialog
async function handleProjectSubmitted(project: Partial<Project>) {
  if (!project) return;

  try {
    uiStore.closeProjectDialog();

    const projectId = project.id
      ? handleProjectUpdate(project)
      : await handleNewProjectCreation(project);

    if (pendingImageFile.value) {
      await onProjectSelected(projectId);
    }
  } catch (error) {
    console.error("Error with project:", error);
    toast.add({
      severity: "error",
      summary: project.id ? $t("toasts.projectUpdateFailed") : $t("toasts.projectCreationFailed"),
      detail: project.id
        ? $t("toasts.projectUpdateFailedDetail")
        : $t("toasts.projectCreationFailedDetail"),
      life: 3000,
    });
  }
}
</script>

<style scoped>
/* Temporary marker styles */
:global(.temp-marker-icon) {
  background: transparent !important;
  border: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

/* Standalone project styles */
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
