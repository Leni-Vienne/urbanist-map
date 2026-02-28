<template>
  <div class="absolute inset-0 overflow-hidden">
    <!-- AI : Mode border overlay - separate from map container to avoid Leaflet rendering issues -->
    <div
      v-if="overlayStore.mode !== 'view'"
      :class="[
        'absolute inset-0 border-4 pointer-events-none z-[900] animate-[borderFadeIn_0.3s_ease-in-out]',
        overlayStore.mode === 'edit' ? 'border-amber-500' : 'border-blue-500',
      ]"
    ></div>

    <div id="mapDiv" class="absolute inset-0">
      <div v-if="isLoading" class="absolute inset-0 flex justify-center items-center bg-gray-200">
        <div class="text-center">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t("pages.home.loadingMapAndData") }}</p>
        </div>
      </div>

      <!-- AI : Top controls container (Search + User Menu) -->
      <div
        class="absolute top-4 left-4 right-4 flex justify-between items-start gap-4 z-[1000] pointer-events-none"
      >
        <div class="pointer-events-auto min-w-0 flex-[0_1_100%] md:flex-[0_1_280px]">
          <CitySearch />
        </div>
        <UserMenu class="flex-shrink-0" />
      </div>

      <!-- AI : Map Controls Component -->
      <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />

      <!-- AI : Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div
        v-if="authStore.isAuthenticated"
        class="absolute bottom-5 left-0 right-0 z-[900] pointer-events-none hidden md:block"
      >
        <ModeControls />
      </div>

      <!-- AI : Satellite Preview Button -->
      <SatellitePreview />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, defineAsyncComponent, watch } from "vue";

import { initializeMap, disableLeafletKeyboardEvents, map } from "@/services/core/map";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { addTileLayer } from "@/services/map/tileLayers";
import { initializeCameraBounds } from "@/services/map/mapNavigation";
import { setupMapClickToDeselect } from "@/services/overlay/overlaySelection";

import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
// AI : Load countries for breadcrumbs (no marker rendering)
import { loadCountriesWithProjects } from "@/services/map/countryData";
import { loadAllCityMarkersGlobally } from "@/services/map/cityMarkers";
import { useViewportTriggers } from "@/composables/viewport/useViewportTriggers";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import ModeControls from "@/components/map/ModeControls.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue"; // no extra bundle "cost"

const MapControls = defineAsyncComponent(() => import("@/components/map/MapControls.vue"));
const UserMenu = defineAsyncComponent(() => import("@/components/auth/UserMenu.vue"));
const CitySearch = defineAsyncComponent(() => import("@/components/map/CitySearch.vue"));

// AI: Get stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();
const isLoading = ref(true);

// AI : NEW: Viewport manager - single rendering path
const viewportManager = useViewportTriggers();

// AI : Reset map state on logout (mode, selection, standalone markers)
watch(
  () => authStore.user,
  (newUser) => {
    if (!newUser) {
      clearAllStandaloneProjectMarkers();
      overlayStore.setMode("view");
      mapStore.clearSelectedCity();
    }
  },
);

// AI : Filter overlays - trigger re-render of loaded cities with new filter state
async function filterOverlaysByCompletionStatus() {
  // AI : Force re-render of all loaded cities which will apply the new filter state
  await viewportManager.reRenderLoadedCities();
}

// AI : Mode changes now handled by viewport manager watch
// AI : Filter watcher removed - viewport manager handles this

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

onUnmounted(() => {
  // AI : Clean up viewport manager
  viewportManager.cleanupEventListeners();
});

// AI : Initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    initializeMap();
    addTileLayer(); // AI : Initialize tile layers after map is created
    initializeCameraBounds(); // AI : Initialize camera bounds tracking

    // AI : Load countries first (needed for breadcrumbs in Current Location panel)
    await loadCountriesWithProjects();

    // AI : Load all city markers globally
    const cities = await loadAllCityMarkersGlobally();

    // AI : Populate cities lookup map in mapStore for panel auto-switch
    mapStore.citiesLookup.clear();
    for (const city of cities) {
      mapStore.citiesLookup.set(city.id, {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      });
    }

    // AI : Setup viewport manager
    viewportManager.setupEventListeners();

    // AI : Ensure map dimensions are calculated before checking bounds
    await nextTick();
    if (map.value !== null) {
      map.value.invalidateSize();
      // AI : Small delay to ensure Leaflet updates bounds after invalidateSize
      setTimeout(() => {
        viewportManager.refreshViewport();
      }, 100);
    } else {
      console.error("Map not available for camera bounds tracking");
    }

    viewportManager.setupModeWatcher();
    setupMapClickToDeselect(); // AI : Setup click handler to deselect overlays when clicking map background
    disableLeafletKeyboardEvents();
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

/* AI : Move Leaflet attribution above mobile drawer handle */
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

/* AI : Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}
</style>
