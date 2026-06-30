<template>
  <div class="absolute inset-0 overflow-hidden">
    <!-- Mode border overlay - separate from map container to avoid map rendering issues -->
    <div
      v-if="mapStore.mode !== 'view'"
      :class="[
        'absolute inset-0 border-4 pointer-events-none z-900 animate-[borderFadeIn_0.3s_ease-in-out]',
        mapStore.mode === 'edit' ? 'border-amber-500' : 'border-blue-500',
      ]"
    ></div>

    <div id="mapDiv" class="absolute inset-0 w-full h-full">
      <div
        v-if="isLoading"
        class="absolute inset-0 flex justify-center items-center bg-content-hover-background"
      >
        <div class="text-center">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t("pages.home.loadingMapAndData") }}</p>
        </div>
      </div>

      <!-- Top controls: Search (left) + User Menu and Settings (right) -->
      <div
        class="absolute top-4 left-4 right-4 flex justify-between items-start gap-4 z-1000 pointer-events-none"
      >
        <div class="pointer-events-auto min-w-0 flex-[0_1_100%] md:flex-[0_1_280px]">
          <CitySearch />
        </div>
        <div class="shrink-0 flex items-center gap-2 pointer-events-auto">
          <UserMenu />
          <SettingsButton />
        </div>
      </div>

      <!-- Right column: Filter + Zoom, stacked below the top controls -->
      <div class="absolute top-18 right-4 z-1000 flex flex-col items-end gap-3 pointer-events-none">
        <div class="pointer-events-auto">
          <FilterControl @filter-overlays="filterOverlaysByCompletionStatus" />
        </div>
        <ZoomControls />
        <CompassControl />
      </div>

      <!-- Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div
        v-if="authStore.isAuthenticated"
        class="absolute bottom-5 left-0 right-0 z-900 pointer-events-none hidden md:block"
      >
        <ModeControls />
      </div>

      <SatellitePreview />
      <OverlayFloatingToolbar v-if="focusStore.selectedOverlayId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, defineAsyncComponent, watch } from "vue";

import { initializeMap, map } from "@/services/core/map";
import { initializeEditorTriggers } from "@/services/overlay/editing";
import { addTileLayer } from "@/services/map/tileLayers";
import { initVectorTileSync } from "@/services/map/vectorTileSync";

import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
import { useViewportTriggers } from "@/composables/viewport/useViewportTriggers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { useAuthStore } from "@/stores/authStore";

import ModeControls from "@/components/map/ModeControls.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue";
import ZoomControls from "@/components/map/ZoomControls.vue";
import CompassControl from "@/components/map/CompassControl.vue";

const OverlayFloatingToolbar = defineAsyncComponent(
  () => import("@/components/map/OverlayFloatingToolbar.vue"),
);
const mapUIBundle = import("@/components/map/mapUIBundle");
const FilterControl = defineAsyncComponent(() => mapUIBundle.then((m) => m.FilterControl));
const UserMenu = defineAsyncComponent(() => mapUIBundle.then((m) => m.UserMenu));
const CitySearch = defineAsyncComponent(() => mapUIBundle.then((m) => m.CitySearch));
const SettingsButton = defineAsyncComponent(() => mapUIBundle.then((m) => m.SettingsButton));

const mapStore = useMapStore();
const focusStore = useFocusStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();
const isLoading = ref(true);

const viewportManager = useViewportTriggers();

watch(
  () => authStore.user,
  (newUser) => {
    if (!newUser) {
      mapStore.setMode("view");
    }
  },
);

async function filterOverlaysByCompletionStatus() {
  await viewportManager.refreshViewport(true);
}

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

onUnmounted(() => {
  viewportManager.cleanupEventListeners();
});

async function initializeMapAndOverlays() {
  try {
    initializeMap();
    initializeEditorTriggers();

    viewportManager.setupEventListeners();

    await nextTick();
    if (map.value !== null) {
      // Settle the canvas to the container size before wiring layers, so MapLibre doesn't
      // fetch tiles twice (once per view change) when the dimensions correct.
      map.value.resize();

      // Initialize tile layers after dimensions are settled to avoid a redundant tile fetch.
      addTileLayer();
      initVectorTileSync();

      setTimeout(() => {
        viewportManager.refreshViewport();
      }, 100);
    } else {
      console.error("Map not available for camera bounds tracking");
    }

    viewportManager.setupModeWatcher();
  } catch (error) {
    console.error("Error initializing map and overlays:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("pages.home.errors.initializationError"),
      life: 5000,
    });
  }
}
</script>

<style scoped>
@keyframes borderFadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* Move map attribution above mobile drawer handle */
@media (max-width: 768px) {
  :deep(.maplibregl-ctrl-attrib) {
    bottom: 4.5rem !important;
    right: 0.5rem !important;
    left: auto !important;
    background: rgba(255, 255, 255, 0.9) !important;
    backdrop-filter: blur(4px) !important;
    border-radius: 0.5rem !important;
    padding: 0.25rem 0.5rem !important;
    margin: 0 !important;
    font-size: 0.75rem !important;
    max-width: calc(100vw - 8rem) !important;
    position: fixed !important;
    display: block !important;
    visibility: visible !important;
    line-height: 1.3 !important;
    white-space: normal !important;
    word-break: break-word !important;
  }
}

/* MapLibre's attribution keeps its light background in dark mode, so the plain (non-link)
   text would inherit the dark-mode light text color and vanish. Force readable colors. */
:deep(.maplibregl-ctrl-attrib) {
  color: rgba(0, 0, 0, 0.75);
}

/* Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}
</style>
