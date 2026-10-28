<template>
  <div
    class="absolute flex items-end justify-center overflow-hidden rounded-lg bg-content-background border-2 border-black cursor-pointer transition-[transform,box-shadow] duration-200 pointer-events-auto hover:scale-105"
    :class="
      inDrawer
        ? 'bottom-0 left-4 z-10 w-16 h-16 hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
        : 'md:flex hidden bottom-6 left-6 z-1000 w-20 h-20 shadow-[0_2px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
    "
    @click.stop="toggleLayer"
    @dblclick.stop
  >
    <img
      :src="isSatellite ? planThumbnail : satelliteThumbnail"
      :alt="isSatellite ? 'Map' : 'Satellite'"
      class="absolute inset-0 w-full h-full object-cover"
    />
    <span
      class="relative z-2 text-white text-[0.85rem] font-medium pb-1.5 [text-shadow:0_0_4px_black,0_0_8px_black,0_0_12px_black]"
      >{{ $t(isSatellite ? "layerControl.plan" : "layerControl.satellite") }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import {
  currentTileLayer,
  switchTileLayer,
  type TileLayerType,
} from "@/services/map/tiles/basemap";
import satelliteThumbnail from "@/assets/satellite_thumbnail.webp";
import planThumbnail from "@/assets/plan_thumbnail.webp";

defineProps<{
  inDrawer?: boolean;
}>();

let lastSatelliteLayer: Exclude<TileLayerType, "plan"> = "esri";

watch(currentTileLayer, (newVal) => {
  if (newVal !== "plan") {
    lastSatelliteLayer = newVal;
  }
});

const isSatellite = computed(() => {
  return currentTileLayer.value !== "plan";
});

let isToggling = false;

async function toggleLayer() {
  if (isToggling) return;
  isToggling = true;
  setTimeout(() => {
    isToggling = false;
  }, 500);
  if (isSatellite.value) {
    await switchTileLayer("plan");
  } else {
    await switchTileLayer(lastSatelliteLayer);
  }
}
</script>
