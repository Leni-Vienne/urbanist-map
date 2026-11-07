<template>
  <CreateProjectDialog
    v-if="uiStore.projectCreationSeed"
    :key="uiStore.projectCreationSeed.lat + ',' + uiStore.projectCreationSeed.lng"
    :project="uiStore.projectCreationSeed"
    @submit="handleProjectSubmitted"
    @close="uiStore.closeProjectDialog"
  />

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
      :key="projectEditTarget.id"
      :project="projectEditTarget"
      @close="uiStore.closeProjectEditForm"
    />
  </Dialog>

  <MarkerPlacementBar />
</template>

<script setup lang="ts">
import { toastError } from "@/services/core/toast";

import { computed, watch, defineAsyncComponent, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import * as maplibregl from "maplibre-gl";
import type { MapMouseEvent, Map as MaplibreMap } from "maplibre-gl";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";

import { onMapReady } from "@/services/core/map";
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
let tempMarker: maplibregl.Marker | null = null;
let placementMap: MaplibreMap | null = null;
let cancelPlacementWait: (() => void) | null = null;

function handleMapClick(e: MapMouseEvent) {
  uiStore.setMarkerCoordinates({ lat: e.lngLat.lat, lng: e.lngLat.lng });
}

function syncPlacementMarker(): void {
  tempMarker?.remove();
  tempMarker = null;
  const coordinates = uiStore.markerCoordinates;
  if (!placementMap || !coordinates) return;

  const element = createProjectPinElement("orange");
  tempMarker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([coordinates.lng, coordinates.lat])
    .addTo(placementMap);
}

watch(() => uiStore.markerCoordinates, syncPlacementMarker, { flush: "sync" });

watch(
  () => uiStore.markerPlacementBarVisible,
  (active) => {
    clearMarkerPlacement();
    if (!active) return;
    cancelPlacementWait = onMapReady((target) => {
      placementMap = target;
      placementMap.on("click", handleMapClick);
      syncPlacementMarker();
    });
  },
  { immediate: true, flush: "sync" },
);

function clearMarkerPlacement() {
  cancelPlacementWait?.();
  cancelPlacementWait = null;
  if (tempMarker) {
    tempMarker.remove();
    tempMarker = null;
  }
  placementMap?.off("click", handleMapClick);
  placementMap = null;
}

onUnmounted(clearMarkerPlacement);

function handleProjectSubmitted(project: Partial<Project>) {
  try {
    uiStore.closeProjectDialog();

    const projectId = createProject({
      ...project,
    });

    if (typeof project.lat === "number" && typeof project.lng === "number") {
      const storedProject = projectStore.projects[projectId];
      if (storedProject) {
        openProjectDetail(storedProject);
      }
    }
  } catch (error) {
    console.error("Error creating project:", error);
    toastError($t("toasts.projectCreationFailedDetail"), $t("toasts.projectCreationFailed"));
  }
}
</script>
