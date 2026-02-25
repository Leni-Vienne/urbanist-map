<template>
  <div class="map-wrapper">
    <!-- AI : Mode border overlay - separate from map container to avoid Leaflet rendering issues -->
    <div
      v-if="overlayStore.mode !== 'view'"
      :class="[
        'mode-border',
        overlayStore.mode === 'edit' ? 'edit-mode-border' : 'moderation-mode-border',
      ]"
    ></div>

    <div id="mapDiv" class="map-container">
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-content">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t("pages.home.loadingMapAndData") }}</p>
        </div>
      </div>

      <!-- AI : Top controls container (Search + User Menu) -->
      <div class="top-controls-container">
        <div class="city-search-container">
          <CitySearch />
        </div>
        <UserMenu class="flex-shrink-0" />
      </div>

      <!-- AI : Map Controls Component -->
      <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />

      <!-- AI : Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div v-if="authStore.isAuthenticated" class="mode-controls-desktop">
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
.map-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

.map-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* AI : Mode borders - positioned relative to map container below tooltips and dialogs */
.mode-border {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 4px solid;
  pointer-events: none;
  z-index: 900;
  animation: borderFadeIn 0.3s ease-in-out;
}

.edit-mode-border {
  border-color: #f59e0b;
  /* Orange for edit mode */
}

.moderation-mode-border {
  border-color: #3b82f6;
  /* Blue for moderation mode */
}

@keyframes borderFadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* AI : Desktop mode controls - positioned absolutely within map container below tooltips and dialogs */
.mode-controls-desktop {
  position: absolute;
  bottom: 1.25rem;
  left: 0;
  right: 0;
  z-index: 900;
  pointer-events: none;
}

@media (max-width: 768px) {
  .mode-controls-desktop {
    display: none;
  }
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgb(221, 221, 221);
}

.loading-content {
  text-align: center;
}

/* AI : Top controls container */
.top-controls-container {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  z-index: 1000;
  pointer-events: none;
}

.city-search-container {
  pointer-events: auto;
  flex: 0 1 280px;
  /* Grow to max 280px, but allow shrinking */
  min-width: 0;
  /* Allow shrinking below content size */
}

@media (max-width: 768px) {
  .city-search-container {
    flex-basis: 100%;
    /* Try to take full width available */
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
    /* AI : Leave space for scale */
    position: fixed !important;
    display: block !important;
    visibility: visible !important;
    line-height: 1.3 !important;
    white-space: normal !important;
    /* AI : Allow text wrapping */
    word-break: break-word !important;
    /* AI : Break long words if needed */
  }
}

/* AI : Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}
</style>
