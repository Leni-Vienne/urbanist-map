<template>
  <div
    class="absolute cursor-pointer rounded-lg transition-[transform,box-shadow] duration-200 pointer-events-auto hover:scale-105"
    :class="
      inDrawer
        ? 'bottom-0 left-4 z-10 w-16 h-16 hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
        : 'md:block hidden bottom-6 left-6 z-[1000] w-20 h-20 shadow-[0_2px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.4)]'
    "
    @click.stop="toggleLayer"
    @dblclick.stop
  >
    <div
      class="w-full h-full relative overflow-hidden rounded-lg bg-[var(--p-surface-0)] border-2 border-black"
    >
      <!-- AI : Using static images for preview to avoid loading actual tiles -->
      <!-- AI : Plan Preview (shown when in Satellite mode) -->
      <div v-if="isSatellite" class="w-full h-full flex items-end justify-center relative">
        <img
          src="https://tile.openstreetmap.org/12/2048/1365.png"
          alt="Map"
          class="absolute inset-0 w-full h-full object-cover"
        />
        <span
          class="relative z-[2] text-white text-[0.85rem] font-medium pb-[6px] [text-shadow:0_0_4px_black,0_0_8px_black,0_0_12px_black]"
          >{{ $t("layerControl.plan") }}</span
        >
      </div>

      <!-- AI : Satellite Preview (shown when in Plan mode) -->
      <div v-else class="w-full h-full flex items-end justify-center relative">
        <img
          src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1365/2048"
          alt="Satellite"
          class="absolute inset-0 w-full h-full object-cover"
        />
        <span
          class="relative z-[2] text-white text-[0.85rem] font-medium pb-[6px] [text-shadow:0_0_4px_black,0_0_8px_black,0_0_12px_black]"
          >{{ $t("layerControl.satellite") }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { currentTileLayer, switchTileLayer, type TileLayerType } from "@/services/map/tileLayers";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  inDrawer?: boolean;
}>();

const { t } = useI18n();

const lastSatelliteLayer = ref<TileLayerType>("esri");

// AI : Track last selected satellite layer to remember user preference
watch(currentTileLayer, (newVal) => {
  if (newVal !== "osm") {
    lastSatelliteLayer.value = newVal as TileLayerType;
  }
});

// AI : Check if current layer is a satellite-type layer
const isSatellite = computed(() => {
  return currentTileLayer.value !== "osm";
});

// AI : Cooldown state to prevent spamming switches
const isToggling = ref(false);

async function toggleLayer() {
  // AI : Prevent spamming: If already toggling (cooldown), ignore click
  if (isToggling.value) return;

  // AI : Apply cooldown lock immediately
  isToggling.value = true;

  // AI : Release cooldown after 500ms
  setTimeout(() => {
    isToggling.value = false;
  }, 500);

  // AI : Smart toggle: If satellite, go to plan. If plan, go to last used satellite.
  // AI : Switching immediately to provide instant feedback (no debounce)
  if (isSatellite.value) {
    await switchTileLayer("osm");
  } else {
    await switchTileLayer(lastSatelliteLayer.value);
  }
}
</script>
