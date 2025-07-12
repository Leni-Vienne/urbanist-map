<template>
  <div
    class="overlay-item p-2 border rounded-md cursor-pointer hover:bg-gray-50"
    @click="$emit('add')"
  >
    <div class="flex justify-between items-center">
      <span class="text-sm font-medium">{{ overlay.caption ?? 'Unnamed Overlay' }}</span>
      <Button
        icon="pi pi-plus"
        class="p-button-text p-button-sm p-button-success"
        @click.stop="$emit('add')"
        v-tooltip.top="'Add to project'"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OverlayObject } from '@types';

interface Props {
  overlay: OverlayObject;
}

defineProps<Props>();

defineEmits<{
  add: [];
}>();
</script>
