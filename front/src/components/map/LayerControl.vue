<template>
  <!-- AI : Layer control button -->
  <Button
    ref="layerButton"
    icon="pi pi-map"
    raised
    @click.stop="toggleLayerPanel"
    @dblclick.stop
    aria-label="Layer Control"
    v-tooltip.right="$t('controls.layers')"
    :severity="showLayerPanel ? undefined : 'secondary'"
  />

  <!-- AI : Layer panel using PrimeVue Popover for small popup -->
  <Popover ref="layerPanel">
    <!-- AI : Base layers section using PrimeVue Panel -->
    <Panel :header="$t('layerControl.baseMaps')" :toggleable="false">
      <div class="flex flex-col gap-2">
        <div v-for="layer in layerOptions" :key="layer.value" class="flex items-center gap-2">
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
        <a href="/contact" class="contact-link text-sm text-muted-color text-center">{{
          $t("layerControl.submitTileLayer")
        }}</a>
      </div>
    </Panel>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  currentTileLayer,
  switchTileLayer,
  getTileLayerOptions,
  type TileLayerType,
} from "@/services/map/tileLayers";
import { flyToCountry } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
import countryBboxes from "@/assets/country_bboxes.json";
import L from "leaflet";

// AI : Panel visibility state
const showLayerPanel = ref(false);

// AI : Refs for button and overlay panel
const layerPanel = ref();

// AI : Get available layer options
const layerOptions = getTileLayerOptions();

// AI : Local reactive reference for the selected layer
const selectedLayer = ref<TileLayerType>(currentTileLayer.value);

// AI : Access map store to check currently viewed country
const mapStore = useMapStore();

// AI : Watch for external changes to current tile layer
watch(currentTileLayer, (newLayer) => {
  selectedLayer.value = newLayer;
});

// AI : Toggle layer panel visibility
function toggleLayerPanel(event: Event) {
  layerPanel.value.toggle(event);
  showLayerPanel.value = !showLayerPanel.value;
}

// AI : Handle layer change from radio buttons - fly to country bounds when switching
async function onLayerChange() {
  try {
    // AI : Switch the tile layer first
    switchTileLayer(selectedLayer.value);

    // AI : Only fly to country bounds for country-specific tile layers
    // AI : OSM/esri (world layers) should not move the camera
    // AI : Also skip flying if user is already viewing that country or is positioned over it
    if (selectedLayer.value !== "osm" && selectedLayer.value !== "esri") {
      const isAlreadyViewingCountry = mapStore.selectedCountryCode === selectedLayer.value;

      // AI : Check if current map center is within the country's bounding box
      let isOverCountry = false;
      const bbox = countryBboxes[selectedLayer.value as keyof typeof countryBboxes];
      if (bbox && map.value) {
        const center = map.value.getCenter();
        const latLngBounds = L.latLngBounds(
          [bbox[1], bbox[0]], // AI : southwest corner [lat, lng]
          [bbox[3], bbox[2]], // AI : northeast corner [lat, lng]
        );
        isOverCountry = latLngBounds.contains(center);
      }

      if (!isAlreadyViewingCountry && !isOverCountry) {
        // AI : Country-specific tile layer (FRA, USA, CHE) - fly to country bounds
        // AI : Note: flyToCountry expects the 3-letter country code
        flyToCountry(
          selectedLayer.value as keyof typeof countryBboxes,
          undefined,
          undefined,
          6,
          1.5,
        );
      }
    }
  } catch (error) {
    console.error("Failed to switch layer:", error);
    // AI : Reset to previous value on error
    selectedLayer.value = currentTileLayer.value;
  }
}

// AI : Watch for popover visibility changes
watch(
  () => layerPanel.value?.visible,
  (visible) => {
    showLayerPanel.value = visible ?? false;
  },
);

// AI : Hide flag on error
function hideFlagOnError(event: Event) {
  const target = event.target as HTMLImageElement;
  target.style.display = "none";
}

// AI : Expose the layer panel ref so parent can close it when needed
defineExpose({
  layerPanel,
});
</script>

<style scoped>
.flag-icon {
  width: 16px;
  height: 12px;
  border-radius: 0.125rem;
  flex-shrink: 0;
}

/* AI : Contact link styling */
.contact-link {
  color: var(--p-primary-color);
  text-decoration: none;
  font-weight: 500;
}

.contact-link:hover {
  text-decoration: underline;
}
</style>
