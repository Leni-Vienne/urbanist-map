<template>  <Dialog
    :visible="visible"
    header="Add Overlay to Project"
    :modal="true"
    :closable="true"
    :style="{ width: '400px', maxWidth: '90vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="available-overlays">
      <h5 class="font-bold mb-2 text-sm">Available Overlays</h5>
      <div
        v-if="availableOverlays.length === 0"
        class="text-center p-2 bg-gray-100 rounded-md text-sm"
      >
        No available overlays to add
      </div>
      <div
        v-else
        class="flex flex-col gap-1 max-h-48 overflow-y-auto"
      >
        <OverlayItem
          v-for="overlay in availableOverlays"
          :key="overlay.id"
          :overlay="overlay"
          @add="$emit('add', overlay.id)"
        />
      </div>
    </div>
    
    <template #footer>
      <Button
        label="Close"
        icon="pi pi-times"
        class="p-button-text p-button-sm"
        @click="$emit('update:visible', false)"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import type { OverlayObject } from '@types';
import OverlayItem from '@components/OverlayItem.vue';

interface Props {
  visible: boolean;
  availableOverlays: OverlayObject[];
}

defineProps<Props>();

defineEmits<{
  'update:visible': [visible: boolean];
  add: [overlayId: string];
}>();
</script>
