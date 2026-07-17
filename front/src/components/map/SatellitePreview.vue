<template>
  <div
    class="absolute cursor-pointer rounded-lg transition-[transform,box-shadow] duration-200 pointer-events-auto hover:scale-105"
    :class="
      inDrawer
        ? 'bottom-0 left-4 z-10 w-16 h-16 hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
        : 'md:block hidden bottom-6 left-6 z-1000 w-20 h-20 shadow-[0_2px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
    "
    @click.stop="toggleLayer"
    @dblclick.stop
  >
    <div
      class="w-full h-full relative overflow-hidden rounded-lg bg-content-background border-2 border-black"
    >
      <!-- Plan preview (shown when in satellite mode) -->
      <div v-if="isSatellite" class="w-full h-full flex items-end justify-center relative">
        <img :src="planThumbnail" alt="Map" class="absolute inset-0 w-full h-full object-cover" />
        <span
          class="relative z-2 text-white text-[0.85rem] font-medium pb-1.5 [text-shadow:0_0_4px_black,0_0_8px_black,0_0_12px_black]"
          >{{ $t("layerControl.plan") }}</span
        >
      </div>

      <!-- Satellite preview (shown when in plan mode) -->
      <div v-else class="w-full h-full flex items-end justify-center relative">
        <img
          :src="satelliteThumbnail"
          alt="Satellite"
          class="absolute inset-0 w-full h-full object-cover"
        />
        <span
          class="relative z-2 text-white text-[0.85rem] font-medium pb-1.5 [text-shadow:0_0_4px_black,0_0_8px_black,0_0_12px_black]"
          >{{ $t("layerControl.satellite") }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

const lastSatelliteLayer = ref<Exclude<TileLayerType, "plan">>("esri");

watch(currentTileLayer, (newVal) => {
  if (newVal !== "plan") {
    lastSatelliteLayer.value = newVal;
  }
});

const isSatellite = computed(() => {
  return currentTileLayer.value !== "plan";
});

const isToggling = ref(false);

async function toggleLayer() {
  if (isToggling.value) return;
  isToggling.value = true;
  setTimeout(() => {
    isToggling.value = false;
  }, 500);
  if (isSatellite.value) {
    await switchTileLayer("plan");
  } else {
    await switchTileLayer(lastSatelliteLayer.value);
  }
}
</script>
