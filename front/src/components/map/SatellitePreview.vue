<template>
  <div
    ref="containerRef"
    class="satellite-preview"
    :class="{ 'in-drawer': inDrawer }"
    @click.stop="toggleLayer"
    @dblclick.stop
    @mouseenter="if (authStore.isAuthenticated) isMenuOpen = true;"
    @mouseleave="isMenuOpen = false"
    @contextmenu.prevent="if (authStore.isAuthenticated) isMenuOpen = !isMenuOpen;"
  >
    <!-- AI : PrimeVue Menu for Satellite Selection -->
    <!-- AI : Wrapped in absolute div to prevent layout shift. @click.stop prevents bubbling to parent toggle. -->
    <div v-if="isMenuOpen" class="satellite-menu-wrapper" @click.stop>
      <Menu :model="items" class="w-auto border-none shadow-none">
        <template #item="{ item, props }">
          <a
            class="flex items-center cursor-pointer px-3 py-2 gap-2 rounded-md transition-colors duration-150"
            :class="{
              'bg-surface-100 text-primary font-semibold': item.value === currentTileLayer,
            }"
            v-bind="props.action"
          >
            <img v-if="item.flag" :src="item.flag" class="w-4 h-2.5 object-cover" alt="" />
            <span class="text-xs font-medium">{{ item.label }}</span>
          </a>
        </template>
      </Menu>
    </div>

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
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import {
  currentTileLayer,
  switchTileLayer,
  getTileLayerOptions,
  type TileLayerType,
} from "@/services/map/tileLayers";
import { useI18n } from "vue-i18n";
import Menu from "primevue/menu";
import { useAuthStore } from "@/stores/authStore";

const props = defineProps<{
  inDrawer?: boolean;
}>();

const emit = defineEmits<{
  (e: "menuChange", isOpen: boolean): void;
}>();

const { t } = useI18n();
const authStore = useAuthStore();
const containerRef = ref<HTMLElement | null>(null);
const isMenuOpen = ref(false);

watch(isMenuOpen, (newValue) => {
  emit("menuChange", newValue);
});

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

// AI : Generate menu items from all available layers including OSM (Plan)
const items = computed(() => {
  return getTileLayerOptions().map((opt) => ({
    label: opt.label,
    value: opt.value,
    flag: opt.flagUrl,
    command: () => {
      switchTileLayer(opt.value);
      isMenuOpen.value = false;
    },
  }));
});

function toggleLayer() {
  // AI : Smart toggle: If satellite, go to plan. If plan, go to last used satellite.
  if (isSatellite.value) {
    switchTileLayer("osm");
  } else {
    switchTileLayer(lastSatelliteLayer.value);
  }
}

// AI : Handle click outside to close menu (redundant if mouseleave handles it, but good for touch)
function handleClickOutside(event: MouseEvent) {
  if (
    isMenuOpen.value &&
    containerRef.value &&
    !containerRef.value.contains(event.target as Node)
  ) {
    isMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
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
  pointer-events: auto;
}

.satellite-preview:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* AI : Custom popup positioning wrapper */
.satellite-menu-wrapper {
  position: absolute;
  bottom: 100%;
  left: 0;
  z-index: 2000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--p-surface-200);
  background: white;
  border-radius: 6px;
  overflow: hidden;
  /* Round corners */
}

/* AI : Ensure inner menu component fits tightly */
:deep(.p-menu) {
  width: fit-content !important;
  min-width: 0 !important;
  border: none;
  background: transparent;
}

.preview-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: white;
  border: 2px solid black;
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
