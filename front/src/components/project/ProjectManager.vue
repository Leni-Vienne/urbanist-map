<template>
  <CreateProjectDialog
    v-if="editingTarget.type === 'create-project'"
    :key="editingTarget.coordinates.lat + ',' + editingTarget.coordinates.lng"
    :project="editingTarget.coordinates"
    @submit="handleProjectSubmitted"
    @close="uiStore.closeEditor('create-project')"
  />

  <Dialog
    v-if="projectEditTarget"
    :visible="true"
    :modal="true"
    :closable="true"
    :draggable="false"
    :header="$t('projectSelector.suggestChanges')"
    @update:visible="uiStore.closeEditor('project-info')"
    :pt="{
      root: { class: 'w-[40rem] max-w-[92vw]' },
      content: { class: '!p-0 sm:overflow-y-auto sm:max-h-[70vh]' },
    }"
  >
    <EditProjectForm
      :key="projectEditTarget.id"
      :project="projectEditTarget"
      @close="uiStore.closeEditor('project-info')"
    />
  </Dialog>

  <MarkerPlacementBar
    v-if="editingTarget.type === 'place-project'"
    :coordinates="editingTarget.coordinates"
  />
</template>

<script setup lang="ts">
import { toastError } from "@/services/core/toast";

import { computed, watch, defineAsyncComponent } from "vue";
import { storeToRefs } from "pinia";
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
const { editingTarget } = storeToRefs(uiStore);
const projectEditTarget = computed(() => {
  const target = editingTarget.value;
  return target.type === "project-info" ? (projectStore.projects[target.projectId] ?? null) : null;
});

const { t: $t } = useI18n();
function handleMapClick(e: MapMouseEvent) {
  if (editingTarget.value.type !== "place-project") return;
  uiStore.openEditor({
    type: "place-project",
    coordinates: { lat: e.lngLat.lat, lng: e.lngLat.lng },
  });
}

watch(
  editingTarget,
  (target, _previous, onCleanup) => {
    if (target.type !== "place-project") return;
    let placementMap: MaplibreMap | null = null;
    let marker: maplibregl.Marker | null = null;
    const cancel = onMapReady((map) => {
      placementMap = map;
      map.on("click", handleMapClick);
      if (target.coordinates) {
        const { lat, lng } = target.coordinates;
        const element = createProjectPinElement("orange");
        marker = new maplibregl.Marker({ element, anchor: "bottom" })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    });
    onCleanup(() => {
      cancel();
      placementMap?.off("click", handleMapClick);
      marker?.remove();
    });
  },
  { immediate: true, flush: "sync" },
);

function handleProjectSubmitted(project: Partial<Project>) {
  try {
    uiStore.closeEditor("create-project");

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
