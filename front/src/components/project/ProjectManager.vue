<template>
  <!-- Project Dialog for create/edit -->
  <CreateProjectDialog
    v-if="uiStore.projectCreationSeed"
    :project="uiStore.projectCreationSeed"
    @submit="handleProjectSubmitted"
    @close="uiStore.closeProjectDialog"
  />

  <!-- Project Edit Form Dialog -->
  <Dialog
    v-if="projectEditTarget"
    :visible="true"
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
      :project="projectEditTarget"
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
import { toastSuccess, toastError } from "@/services/core/toast";

import { computed, ref, defineAsyncComponent, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import * as maplibregl from "maplibre-gl";
import type { MapMouseEvent } from "maplibre-gl";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";

import { getMap, getMapOrNull } from "@/services/core/map";
import { createProjectPinElement } from "@/services/core/markersSvg";
import { createProject } from "@/services/project/projectMutations";
import { openProjectDetail } from "@/services/core/projectSelection";
import type { Project } from "@/types/index";

import MarkerPlacementBar from "@/components/map/MarkerPlacementBar.vue";
const CreateProjectDialog = defineAsyncComponent(
  () => import("@/components/project/CreateProjectDialog.vue"),
);
const EditProjectForm = defineAsyncComponent(
  () => import("@/components/forms/EditProjectForm.vue"),
);

const projectStore = useProjectStore();
const uiStore = useUiStore();
const projectEditTarget = computed(() => {
  const projectId = uiStore.projectEditTargetId;
  return projectId ? (projectStore.projects[projectId] ?? null) : null;
});

const { t: $t } = useI18n();
const markerPlacementBar = ref<InstanceType<typeof MarkerPlacementBar> | null>(null);
let tempMarker: maplibregl.Marker | null = null;

function onMarkerCoordinatesSelected(coordinates: { lat: number; lng: number }) {
  if (tempMarker) {
    tempMarker.remove();
    tempMarker = null;
  }

  uiStore.openProjectDialog({
    lat: coordinates.lat,
    lng: coordinates.lng,
  });
}

function handleMapClick(e: MapMouseEvent) {
  const coordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };

  if (tempMarker) {
    tempMarker.remove();
    tempMarker = null;
  }

  const element = createProjectPinElement("orange");
  tempMarker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([coordinates.lng, coordinates.lat])
    .addTo(getMap());

  if (markerPlacementBar.value) {
    markerPlacementBar.value.setMarkerCoordinates(coordinates);
  }
}

function onMarkerModeEnabled() {
  getMap().on("click", handleMapClick);
}

function onDialogVisibilityChange(visible: boolean) {
  if (!visible) clearMarkerPlacement();
}

function clearMarkerPlacement() {
  if (tempMarker) {
    tempMarker.remove();
    tempMarker = null;
  }
  getMapOrNull()?.off("click", handleMapClick);
}

onUnmounted(clearMarkerPlacement);

function handleProjectSubmitted(project: Partial<Project>) {
  try {
    uiStore.closeProjectDialog();

    const projectId = createProject({
      ...project,
      isModified: true,
    });

    if (typeof project.lat === "number" && typeof project.lng === "number") {
      const storedProject = projectStore.projects[projectId];
      if (storedProject) {
        openProjectDetail(storedProject);
      }
      toastSuccess($t("toasts.projectCreatedSuccess"));
    }
  } catch (error) {
    console.error("Error creating project:", error);
    toastError($t("toasts.projectCreationFailedDetail"), $t("toasts.projectCreationFailed"));
  }
}
</script>
