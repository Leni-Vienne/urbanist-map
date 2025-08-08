<template>
    <div class="layer-control-container">
        <!-- AI : Layer control button -->
        <div class="card flex">
            <Button
                ref="layerButton"
                icon="pi pi-map"
                @click="toggleLayerPanel"
                aria-label="Layer Control"
                v-tooltip.right="'Map Layers'"
                :severity="showLayerPanel ? undefined : 'secondary'"
            />
        </div>

        <!-- AI : Layer panel using PrimeVue Popover for small popup -->
        <Popover
            ref="layerPanel"
            class="layer-popover"
        >
            <div class="flex flex-col gap-4">
                <!-- AI : Base layers section using PrimeVue Panel -->
                <Panel
                    header="Base Maps"
                    :toggleable="false"
                >
                    <div class="flex flex-col gap-3">
                        <div
                            v-for="layer in layerOptions"
                            :key="layer.value"
                            class="flex align-items-center gap-2"
                        >
                            <RadioButton
                                :id="layer.value"
                                v-model="selectedLayer"
                                :value="layer.value"
                                @change="onLayerChange"
                            />
                            <label
                                :for="layer.value"
                                class="cursor-pointer"
                            >
                                {{ layer.label }}
                            </label>
                        </div>
                    </div>
                </Panel>
            </div>
        </Popover>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { currentTileLayer, switchTileLayer, getTileLayerOptions, type TileLayerType } from '@composables/map/useTileLayers';

// AI : Panel visibility state
const showLayerPanel = ref(false);

// AI : Refs for button and overlay panel
const layerButton = ref();
const layerPanel = ref();

// AI : Get available layer options
const layerOptions = getTileLayerOptions();

// AI : Local reactive reference for the selected layer
const selectedLayer = ref<TileLayerType>(currentTileLayer.value);

// AI : Watch for external changes to current tile layer
watch(currentTileLayer, (newLayer) => {
    selectedLayer.value = newLayer;
});

// AI : Toggle layer panel visibility
function toggleLayerPanel(event: Event) {
    layerPanel.value.toggle(event);
    showLayerPanel.value = !showLayerPanel.value;
}

// AI : Handle layer change from radio buttons
async function onLayerChange() {
    try {
        await switchTileLayer(selectedLayer.value);
    } catch (error) {
        console.error('AI : Failed to switch layer:', error);
        // AI : Reset to previous value on error
        selectedLayer.value = currentTileLayer.value;
    }
}

// AI : Watch for popover visibility changes
watch(() => layerPanel.value?.visible, (visible) => {
    showLayerPanel.value = visible ?? false;
});
</script>

<style scoped>
.layer-control-container {
    position: relative;
}

/* AI : Custom popover styling */
:deep(.layer-popover) {
    width: 280px;
}

:deep(.layer-popover .p-panel-header) {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
}

:deep(.layer-popover .p-panel-content) {
    padding: 0.75rem 1rem;
}
</style>
