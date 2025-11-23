<template>
    <!-- AI : Layer control button -->
    <Button
        ref="layerButton"
        icon="pi pi-map"
        raised
        @click.stop="toggleLayerPanel"
        @dblclick.stop
        aria-label="Layer Control"
        v-tooltip.right="'Map Layers'"
        :severity="showLayerPanel ? undefined : 'secondary'"
    />

    <!-- AI : Layer panel using PrimeVue Popover for small popup -->
    <Popover ref="layerPanel">
        <!-- AI : Base layers section using PrimeVue Panel -->
        <Panel
            :header="$t('layerControl.baseMaps')"
            :toggleable="false"
        >
            <div class="flex flex-col gap-2">
                <div
                    v-for="layer in layerOptions"
                    :key="layer.value"
                    class="flex items-center gap-2"
                >
                    <RadioButton
                        :id="layer.value"
                        v-model="selectedLayer"
                        :inputId="layer.value"
                        :value="layer.value"
                        @change="onLayerChange"
                    />
                    <label :for="layer.value" class="flex items-center gap-2">
                        <img 
                            :src="layer.flagUrl" 
                            :alt="`${layer.label} flag`"
                            class="flag-icon"
                            @error="hideFlagOnError"
                        />
                        {{ layer.label }}
                    </label>
                </div>
            </div>
        </Panel>
    </Popover>
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
        switchTileLayer(selectedLayer.value);
    } catch (error) {
        console.error('Failed to switch layer:', error);
        // AI : Reset to previous value on error
        selectedLayer.value = currentTileLayer.value;
    }
}

// AI : Watch for popover visibility changes
watch(() => layerPanel.value?.visible, (visible) => {
    showLayerPanel.value = visible ?? false;
});

// AI : Hide flag on error
function hideFlagOnError(event: Event) {
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
}
</script>

<style scoped>
.flag-icon {
    width: 16px;
    height: 12px;
    border-radius: 0.125rem;
    flex-shrink: 0;
}
</style>