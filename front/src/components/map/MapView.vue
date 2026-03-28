<template>
  <div class="absolute inset-0 overflow-hidden">
    <!-- Mode border overlay - separate from map container to avoid Leaflet rendering issues -->
    <div
      v-if="mapStore.mode !== 'view'"
      :class="[
        'absolute inset-0 border-4 pointer-events-none z-900 animate-[borderFadeIn_0.3s_ease-in-out]',
        mapStore.mode === 'edit' ? 'border-amber-500' : 'border-blue-500',
      ]"
    ></div>

    <div id="mapDiv" class="absolute inset-0">
      <div
        v-if="isLoading"
        class="absolute inset-0 flex justify-center items-center bg-content-hover-background"
      >
        <div class="text-center">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t("pages.home.loadingMapAndData") }}</p>
        </div>
      </div>

      <!-- Top controls container (Search + User Menu) -->
      <div
        class="absolute top-4 left-4 right-4 flex justify-between items-start gap-4 z-1000 pointer-events-none"
      >
        <div class="pointer-events-auto min-w-0 flex-[0_1_100%] md:flex-[0_1_280px]">
          <CitySearch />
        </div>
        <UserMenu class="shrink-0" />
      </div>

      <!-- Map Controls Component -->
      <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />

      <!-- Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div
        v-if="authStore.isAuthenticated"
        class="absolute bottom-5 left-0 right-0 z-900 pointer-events-none hidden md:block"
      >
        <ModeControls />
      </div>

      <!-- Satellite Preview Button -->
      <SatellitePreview />

      <!-- Floating toolbar for selected overlays (replaces leaflet-toolbar popup) -->
      <OverlayFloatingToolbar v-if="overlayStore.idSelectedOverlay" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, defineAsyncComponent, watch } from "vue";

import { initializeMap, disableLeafletKeyboardEvents, map } from "@/services/core/map";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { addTileLayer } from "@/services/map/tileLayers";
import { initVectorTileSync } from "@/services/map/vectorTileSync";
import { initializeCameraBounds } from "@/services/map/mapNavigation";
import { setupMapClickToDeselect } from "@/services/overlay/overlaySelection";

import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
// Load countries for breadcrumbs (no marker rendering)
import { loadCountriesWithProjects } from "@/services/map/countryData";
import { useViewportTriggers } from "@/composables/viewport/useViewportTriggers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";

import ModeControls from "@/components/map/ModeControls.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue"; // no extra bundle "cost"

const OverlayFloatingToolbar = defineAsyncComponent(
  () => import("@/components/map/OverlayFloatingToolbar.vue"),
);
const mapUIBundle = import("@/components/map/mapUIBundle");
const MapControls = defineAsyncComponent(() => mapUIBundle.then((m) => m.MapControls));
const UserMenu = defineAsyncComponent(() => mapUIBundle.then((m) => m.UserMenu));
const CitySearch = defineAsyncComponent(() => mapUIBundle.then((m) => m.CitySearch));

// Get stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();
const isLoading = ref(true);

// NEW: Viewport manager - single rendering path
const viewportManager = useViewportTriggers();

// Reset map state on logout (mode, selection, standalone markers)
watch(
  () => authStore.user,
  (newUser) => {
    if (!newUser) {
      clearAllStandaloneProjectMarkers();
      mapStore.setMode("view");
    }
  },
);

// Filter overlays - force viewport re-render with new filter state
async function filterOverlaysByCompletionStatus() {
  await viewportManager.refreshViewport(true);
}

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

onUnmounted(() => {
  // Clean up viewport manager
  viewportManager.cleanupEventListeners();
});

// Initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    initializeMap();
    initializeCameraBounds(); // Initialize camera bounds tracking

    // Setup viewport manager
    viewportManager.setupEventListeners();

    // Ensure map dimensions are calculated before checking bounds
    await nextTick();
    if (map.value !== null) {
      // Pass false to disable animation during the initial size/bounds correction.
      // This prevents a bounds correction from triggering a slow pan, which causes
      // MapLibre to fetch tiles twice (once for the original center, once for the corrected).
      map.value.invalidateSize(false);

      // Initialize tile layers after map is created and dimensions are correct
      // This prevents maplibre from double-fetching tiles due to resize immediately after load
      addTileLayer();
      initVectorTileSync(); // Start idle-driven overlay sync for view mode

      // Small delay to ensure Leaflet updates bounds after invalidateSize
      setTimeout(() => {
        viewportManager.refreshViewport();
      }, 100);
    } else {
      console.error("Map not available for camera bounds tracking");
    }

    viewportManager.setupModeWatcher();
    setupMapClickToDeselect(); // Setup click handler to deselect overlays when clicking map background
    disableLeafletKeyboardEvents();

    // Load countries in the background -- not needed for initial map render.
    // Countries are needed for breadcrumbs in the Current Location panel.
    loadCountriesWithProjects().catch((error) => {
      console.error("[MapView] Error loading countries:", error);
    });
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

/* Move Leaflet attribution above mobile drawer handle */
@media (max-width: 768px) {
  :deep(.leaflet-control-attribution) {
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

/* Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}
</style>
