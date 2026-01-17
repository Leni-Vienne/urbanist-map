<template>
  <div
    class="satellite-preview"
    :class="{ 'in-drawer': inDrawer }"
    @click.stop="toggleLayer"
    @dblclick.stop
  >
    <div class="preview-container" :class="{ 'is-satellite': isSatellite }">
      <!-- AI : Using static images for preview to avoid loading actual tiles -->
      <!-- AI : Plan Preview (shown when in Satellite mode) -->
      <div v-if="isSatellite" class="preview-content">
        <img
          src="https://tile.openstreetmap.org/12/2048/1365.png"
          alt="Map"
          class="preview-image"
        />
        <span class="preview-label">{{ $t("layerControl.plan") }}</span>
      </div>

      <!-- AI : Satellite Preview (shown when in Plan mode) -->
      <div v-else class="preview-content">
        <img
          src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1365/2048"
          alt="Satellite"
          class="preview-image"
        />
        <span class="preview-label">{{ $t("layerControl.satellite") }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  currentTileLayer,
  switchTileLayer,
  isTileLayerType,
  type TileLayerType,
} from "@/services/map/tileLayers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useI18n } from "vue-i18n";

defineProps<{
  inDrawer?: boolean;
}>();

const { t } = useI18n();
const mapStore = useMapStore();

// AI : Check if current layer is a satellite-type layer
const isSatellite = computed(() => {
  return currentTileLayer.value !== "osm";
});

// AI : Determine the target satellite layer based on context
const targetSatelliteLayer = computed<TileLayerType>(() => {
  // AI : Check if we have a selected city with a supported country code
  if (mapStore.selectedCity?.countryCode && isTileLayerType(mapStore.selectedCity.countryCode)) {
    return mapStore.selectedCity.countryCode;
  }

  // AI : Fallback to global selected country code
  if (mapStore.selectedCountryCode && isTileLayerType(mapStore.selectedCountryCode)) {
    return mapStore.selectedCountryCode as TileLayerType;
  }

  return "esri";
});

function toggleLayer() {
  if (isSatellite.value) {
    // AI : Switch to Map (OSM)
    switchTileLayer("osm");
  } else {
    // AI : Switch to context-aware satellite layer
    switchTileLayer(targetSatelliteLayer.value);
  }
}
</script>

<style scoped>
.satellite-preview {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 1000;
  cursor: pointer;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  width: 80px;
  height: 80px;
  background: white;
  overflow: hidden;
  border: 2px solid black;
  pointer-events: auto;
  /* AI : White border looks cleaner usually but user requested black. */
  /* User specifically asked for "black border instead of white". */
}

.satellite-preview:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.preview-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.preview-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  position: relative;
}

.preview-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-label {
  position: relative;
  z-index: 2;
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  padding-bottom: 6px;
  /* AI : Stronger shadow as requested */
  text-shadow:
    0 0 4px black,
    0 0 8px black,
    0 0 12px black;
}

/* AI : Mobile adjustments */
@media (max-width: 768px) {
  /* AI : Default behavior on mobile: Hide (because it will be rendered in MobileDrawer) */
  .satellite-preview:not(.in-drawer) {
    display: none;
  }

  /* AI : In-Drawer behavior: Visible and positioned relative to drawer header */
  .satellite-preview.in-drawer {
    position: absolute;
    bottom: 0px;
    /* Aligns with bottom of .drawer-above-content */
    left: 16px;
    /* Reset any conflicting styles */
    z-index: 10;

    /* Adjust size for mobile if needed, though 80px might be okay or 64px */
    width: 64px;
    height: 64px;
  }
}
</style>
