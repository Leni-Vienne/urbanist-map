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
    :pt="{
      root: { class: 'w-[40rem] max-w-[92vw]' },
      content: { class: '!p-0 sm:overflow-y-auto sm:max-h-[70vh]' },
    }"
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
import maplibregl, { type MapMouseEvent } from "maplibre-gl";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { map } from "@/services/core/map";
import {
  getStandaloneProjectMarkerByProjectId,
  addStandaloneProjectMarkerForProject,
  updateStandaloneProjectMarkerColor,
} from "@/services/map/standaloneProjectMarkers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { createStandaloneProjectMarkerElement } from "@/services/map/markers";
import { addOverlay } from "@/services/overlay/editing";
import { createProject } from "@/services/project/projectMutations";
import { createProjectObject } from "@/utils/typeFactories";
import type { Project } from "@/types/index";

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
const tempMarker = ref<maplibregl.Marker | null>(null);
const mapClickHandler = ref<((e: MapMouseEvent) => void) | null>(null);

const { projects } = storeToRefs(projectStore);
const { pendingImageFile, replacementOverlayId } = storeToRefs(overlayStore);
const { projectEditForm } = storeToRefs(uiStore);

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

function findProjectFromCityProjects(projectId: string): Project | null {
  const cityProject = Object.values(projects.value).find((p: Project) => p.id === projectId);
  return cityProject ?? null;
}

function addProjectToStore(projectId: string, project: Project): void {
  projects.value[projectId] = project;
}

async function onProjectSelected(projectId: string) {
  if (!projectId) {
    console.warn("No project ID available for overlay");
    return;
  }

  if (!projects.value[projectId]) {
    try {
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
      if (isReplacement && replacementOverlayId.value) {
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
        addOverlay(reader.result as string, projectId);
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
      overlayStore.resetReplacement();
    }
  });
  reader.readAsDataURL(pendingImageFile.value);
}

function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  if (tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }

  uiStore.openProjectDialog({
    lat: coordinates.lat,
    lng: coordinates.lng,
  });
}

function handleMapClick(e: MapMouseEvent) {
  const coordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };

  if (tempMarker.value) {
    tempMarker.value.remove();
    tempMarker.value = null;
  }

  const mapValue = map.value;
  if (!mapValue) return;

  const element = createStandaloneProjectMarkerElement("orange");
  tempMarker.value = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([coordinates.lng, coordinates.lat])
    .addTo(mapValue);

  if (markerPlacementBar.value) {
    markerPlacementBar.value.setMarkerCoordinates(coordinates);
  }
}

function onMarkerModeEnabled() {
  mapClickHandler.value = handleMapClick;
  map.value.on("click", handleMapClick);
}

function onDialogVisibilityChange(visible: boolean) {
  if (!visible) {
    if (tempMarker.value) {
      tempMarker.value.remove();
      tempMarker.value = null;
    }

    if (mapClickHandler.value) {
      map.value.off("click", mapClickHandler.value);
      mapClickHandler.value = null;
    }
  }
}

async function displayProjectMarkerAndDetail(
  projectId: string,
  city: {
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
    coordinates: { x: number; y: number };
  },
) {
  const countryCode = city.countryCode;
  if (countryCode && mapStore.selectedCountryCode !== countryCode) {
    mapStore.selectedCountryCode = countryCode;
  }

  let actualMarker = getStandaloneProjectMarkerByProjectId(projectId);

  if (!actualMarker) {
    const project = projectStore.projects[projectId];
    if (project) {
      addStandaloneProjectMarkerForProject(project);
      actualMarker = getStandaloneProjectMarkerByProjectId(projectId);
    }
  }

  if (actualMarker) {
    if (overlayStore.overlayDetailVisible) {
      overlayStore.closeOverlayDetail();
    }
    uiStore.openProjectDetail(projectId, projectStore.projects[projectId]);

    const project = projectStore.projects[projectId];
    if (project && typeof project.lat === "number" && typeof project.lng === "number") {
      const currentZoom = map.value.getZoom();
      const targetZoom = Math.max(currentZoom, 16);
      map.value.flyTo({
        center: [project.lng, project.lat],
        zoom: targetZoom,
        duration: 1000,
        essential: true,
      });
    }
  }
}

async function handleNewProjectCreation(project: Partial<Project>): Promise<string> {
  const projectId = createProject({
    ...project,
    isModified: true,
  });

  const hasNoOverlays = !project.overlayIds || project.overlayIds.length === 0;
  if (hasNoOverlays && typeof project.lat === "number" && typeof project.lng === "number") {
    if (project.city) {
      await displayProjectMarkerAndDetail(projectId, project.city);
    } else {
      const storedProject = projectStore.projects[projectId];
      if (storedProject) {
        addStandaloneProjectMarkerForProject(storedProject);
        const marker = getStandaloneProjectMarkerByProjectId(projectId);
        if (marker) {
          uiStore.openProjectDetail(projectId, storedProject);
        }
      }
    }
    toast.add({
      severity: "success",
      summary: $t("common.success"),
      detail: $t("toasts.standaloneProjectSuccess"),
      life: 3000,
    });
  }

  return projectId;
}

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
:global(.temp-marker-icon) {
  background: transparent !important;
  border: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

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
