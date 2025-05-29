<template>
  <div class="mb-3">
    <div class="flex justify-between items-center mb-2">
      <h5 class="font-bold text-sm">Project Overlays</h5>
      <span class="text-xs bg-gray-200 px-2 py-1 rounded-full">
        {{ project.overlayIds.length }} overlays
      </span>
    </div>

    <div
      v-if="project.overlayIds.length === 0"
      class="text-center p-2 bg-gray-100 rounded-md text-sm"
    >
      No overlays in this project yet
    </div>
    <ProjectOverlaysList
      v-else
      :overlays="overlays"
      @view="$emit('view', $event)"
      @remove="$emit('remove', $event)"
    />
    
    <Button
      label="Add Overlay"
      icon="pi pi-plus"
      class="p-button-outlined p-button-sm mt-2"
      @click="$emit('add-overlay')"
    />
  </div>
</template>

<script setup lang="ts">
import type { Project, OverlayListItem } from '@types';
import ProjectOverlaysList from '@components/project/ProjectOverlaysList.vue';

interface Props {
  project: Project;
  overlays: OverlayListItem[];
}

defineProps<Props>();

defineEmits<{
  view: [overlayId: string];
  remove: [overlayId: string];
  'add-overlay': [];
}>();
</script>
