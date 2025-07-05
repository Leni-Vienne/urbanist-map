<template>
  <div class="tile-layer-selector">
    <Select
      v-model="selectedLayer"
      :options="layerOptions"
      optionLabel="label"
      optionValue="value"
      @change="onLayerChange"
      class="w-full"
      :placeholder="'Select tile layer'"
    >
      <template #value="slotProps">
        <div
          v-if="slotProps.value"
          class="flex items-center gap-2"
        >
          <i class="pi pi-map text-sm"></i>
          &nbsp;
          <span class="text-sm">{{ getLayerLabel(slotProps.value) }}</span>
        </div>
        <span
          v-else
          class="text-sm"
        >{{ slotProps.placeholder }}</span>
      </template>
      <template #option="slotProps">
        <div class="flex items-center gap-2">
          <i class="pi pi-map text-sm"></i>&nbsp;
          <span>{{ slotProps.option.label }}</span>
        </div>
      </template>
    </Select>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { currentTileLayer, switchTileLayer, getTileLayerOptions, type TileLayerType } from '@composables/map/useTileLayers';

// AI : Get available layer options
const layerOptions = getTileLayerOptions();

// AI : Local reactive reference for the dropdown
const selectedLayer = ref<TileLayerType>(currentTileLayer.value);

// AI : Watch for external changes to current tile layer
watch(currentTileLayer, (newLayer) => {
  selectedLayer.value = newLayer;
});

// AI : Handle layer change from dropdown
async function onLayerChange(event: any) {
  const newLayer = event.value as TileLayerType;
  try {
    await switchTileLayer(newLayer);
  } catch (error) {
    console.error('Failed to switch layer:', error);
    // AI : Reset to previous value on error
    selectedLayer.value = currentTileLayer.value;
  }
}

// AI : Get the display label for a layer value
function getLayerLabel(value: TileLayerType): string {
  const option = layerOptions.find(opt => opt.value === value);
  return option?.label || value;
}
</script>

<style scoped>
.tile-layer-selector {
  min-width: 150px;
}

:deep(.p-select) {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #dee2e6;
  border-radius: 6px;
}

:deep(.p-select:not(.p-disabled):hover) {
  border-color: #007bff;
}

:deep(.p-select.p-focus) {
  outline: 0 none;
  outline-offset: 0;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
  border-color: #007bff;
}
</style>
