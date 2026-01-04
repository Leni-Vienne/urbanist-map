<template>
  <div class="map-wrapper">
    <!-- AI : Mode border overlay - separate from map container to avoid Leaflet rendering issues -->
    <div
      v-if="overlayStore.mode !== 'view'"
      :class="[
        'mode-border',
        overlayStore.mode === 'edit' ? 'edit-mode-border' : 'moderation-mode-border'
      ]"
    ></div>

    <div id="mapDiv" class="map-container">
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-content">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t('pages.home.loadingMapAndData') }}</p>
        </div>
      </div>

      <!-- AI : City search in top-left corner -->
      <div class="city-search-container">
        <CitySearch />
      </div>

      <!-- AI : User Menu in top-right corner -->
      <UserMenu />

      <!-- AI : Map Controls Component -->
      <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />

      <!-- AI : Help button to guide user to click markers -->
      <MarkerHelpButton />

      <!-- AI : Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div v-if="authStore.isAuthenticated" class="mode-controls-desktop">
        <ModeControls />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@/composables/core/useMap';
import { addTileLayer } from '@/composables/map/useTileLayers';
import { initializeCameraBounds } from '@/composables/map/useMapNavigation';
import { renderViewModeOverlays, undo, redo } from '@/composables/overlay/useOverlay';
import { setupMapClickToDeselect } from '@/composables/overlay/useOverlaySelection';
import { removeOverlayFromMap } from '@/composables/overlay/useOverlayRemoval';
import { useToast } from '@/composables/ui/useToast';
import { useI18n } from 'vue-i18n';
import { updateOverlayMarkersForFilters } from '@/composables/map/useCityOverlays';
// AI : Load countries for breadcrumbs (no marker rendering)
import { loadCountriesWithProjects } from '@/composables/map/useCountryData';
import { loadAllCityMarkersGlobally } from '@/composables/map/useCityMarkers';
import { useViewportContentManager } from '@/composables/viewport/useViewportContentManager';
import { useMapStore } from '@/stores/pinia/mapStore';
import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { useAuthStore } from '@/stores/authStore';
import type { OverlayData } from '@/types/index';
import ModeControls from '@/components/map/ModeControls.vue';

const MapControls = defineAsyncComponent(() => import('@/components/map/MapControls.vue'));
const UserMenu = defineAsyncComponent(() => import('@/components/auth/UserMenu.vue'));
const MarkerHelpButton = defineAsyncComponent(() => import('@/components/map/MarkerHelpButton.vue'));
const CitySearch = defineAsyncComponent(() => import('@/components/map/CitySearch.vue'));

// AI: Get stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();
const isLoading = ref(true);

// AI : NEW: Viewport manager - single rendering path
const viewportManager = useViewportContentManager();

// AI : Filter overlays - now integrated with viewport manager
async function filterOverlaysByCompletionStatus() {
  // AI : Just trigger viewport refresh which handles filtering
  await viewportManager.refreshViewport();
}

// AI : Mode changes now handled by viewport manager watch
// AI : Filter watcher removed - viewport manager handles this

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

onUnmounted(() => {
  // AI : Clean up event listeners
  globalThis.removeEventListener('keydown', handleKeyDown, true);
  // AI : Clean up viewport manager
  viewportManager.cleanupEventListeners();
});


// AI : Keyboard shortcuts handler
function handleKeyDown(event: KeyboardEvent) {
  // AI : Undo: Ctrl+Z (works on all keyboard layouts)
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
    undo();
  }
  // AI : Redo: Ctrl+Y (AZERTY) or Ctrl+Shift+Z (QWERTY)
  else if (event.ctrlKey && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
    redo();
  }
}




// AI : Initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    initializeMap();
    addTileLayer(); // AI : Initialize tile layers after map is created
    initializeCameraBounds(); // AI : Initialize camera bounds tracking

    // AI : Load countries first (needed for breadcrumbs in Current Location panel)
    await loadCountriesWithProjects();

    // AI : Load all city markers globally instead of country markers
    const cities = await loadAllCityMarkersGlobally();

    // AI : Populate cities lookup map in mapStore for panel auto-switch
    mapStore.citiesLookup.clear();
    cities.forEach(city => {
      mapStore.citiesLookup.set(city.id, {
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      });
    });

    // AI : Setup viewport manager (replaces old viewport loading + mode system)
    viewportManager.setupEventListeners();

    // AI : Watch for mode changes to trigger viewport refresh
    watch(() => overlayStore.mode, () => {
      viewportManager.refreshViewport();
    });
    setupMapClickToDeselect(); // AI : Setup click handler to deselect overlays when clicking map background
    globalThis.addEventListener('keydown', handleKeyDown, true);
    disableLeafletKeyboardEvents();

  } catch (error) {
    console.error('Error initializing map and overlays:', error);
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('pages.home.errors.initializationError'),
      life: 5000
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
  background-color: black;
}

.loading-content {
  text-align: center;
}

/* AI : City search positioned in top-left corner */
.city-search-container {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1000;
  pointer-events: auto;
}

@media (max-width: 768px) {
  .city-search-container {
    left: 16px;
    right: 16px;
    max-width: calc(100% - 80px);
    /* AI : Leave space for language/user menu */
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

  :deep(.leaflet-control-scale) {
    bottom: 4.5rem !important;
    /* AI : Same level as attribution */
    left: 0.5rem !important;
    backdrop-filter: blur(4px) !important;
    border-radius: 0.5rem !important;
    padding: 0.25rem !important;
    margin: 0 !important;
    position: fixed !important;
    display: block !important;
    visibility: visible !important;
  }
}

/* AI : Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}
</style>
