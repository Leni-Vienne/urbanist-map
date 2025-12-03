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

    <div
      id="mapDiv"
      class="map-container"
    >
      <div
        v-if="isLoading"
        class="loading-overlay"
      >
        <div class="loading-content">
          <i class="pi pi-spin pi-spinner text-4xl"></i>
          <p class="mt-2">{{ t('pages.home.loadingMapAndData') }}</p>
        </div>
      </div>
      <!-- AI : User Menu in top-right corner -->
      <UserMenu />

      <!-- AI : Map Controls Component -->
      <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />

      <!-- AI : Help button to guide user to click markers -->
      <MarkerHelpButton />

      <!-- AI : Mode controls wrapper - desktop only (mobile version is in MobileDrawer) -->
      <div
        v-if="authStore.isAuthenticated"
        class="mode-controls-desktop"
      >
        <ModeControls />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@composables/core/useMap';
import { addTileLayer } from '@composables/map/useTileLayers';
import { initializeCameraBounds } from '@composables/map/useMapNavigation';
import { renderViewModeOverlays, undo, redo, setupMapClickToDeselect } from '@composables/overlay/useOverlay';
import { removeOverlayFromMap } from '@composables/overlay/useOverlayRemoval';
import { useToast } from '@composables/ui/useToast';
import { useI18n } from '@composables/useI18n';
import { updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { initializeOverlayModes } from '@composables/overlay/useOverlayModes';
import { loadCityStandaloneProjects } from '@composables/map/useCityMarkers';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useAuthStore } from '@stores/authStore';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import type { OverlayData } from '@types';
import ModeControls from '@components/map/ModeControls.vue';

const MapControls = defineAsyncComponent(() => import('@components/map/MapControls.vue'));
const UserMenu = defineAsyncComponent(() => import('@components/auth/UserMenu.vue'));
const MarkerHelpButton = defineAsyncComponent(() => import('@components/map/MarkerHelpButton.vue'));

// AI: Get stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();
const isLoading = ref(true);

// AI : Filter overlays based on completion status
async function filterOverlaysByCompletionStatus() {
  const completionFilters = useCompletionFilters();

  if (!map.value) return;

  // AI : If we have overlay markers visible (when zoomed out), update them with filters
  updateOverlayMarkersForFilters();

  // AI : Get overlay data from cache instead of currentCityOverlays (which can be cleared)
  const selectedCityId = mapStore.selectedCity?.id;
  if (!selectedCityId) return;

  // AI : Load from cache - this is more reliable than currentCityOverlays
  const cachedData = mapStore.getCityOverlaysAndProjectsCache(selectedCityId, overlayStore.mode);

  // AI : If cache is empty (null/undefined or empty array) but currentCityOverlays has data, use currentCityOverlays
  if ((!cachedData || cachedData.length === 0) && mapStore.currentCityOverlays?.length) {
    mapStore.setCityProjectsCache(selectedCityId, overlayStore.mode, mapStore.currentCityOverlays);
  }

  // AI : Use cached data only if it has items, otherwise fall back to currentCityOverlays
  const cityOverlays = (cachedData?.length) ? cachedData : (mapStore.currentCityOverlays ?? []);

  // AI : Always reload standalone projects first (even if no overlays for this city)
  await loadCityStandaloneProjects(selectedCityId);

  // AI : If no overlays, we're done (but standalone projects were reloaded above)
  if (!cityOverlays.length) return;

  // AI : Use the shared filtering utility
  const visibleOverlays = completionFilters.filterByCompletionStatus(cityOverlays) as OverlayData[];
  const visibleOverlayIds = new Set(visibleOverlays.map(o => o.id));

  // AI : Remove overlays that should be hidden
  const overlaysToHide = cityOverlays.filter(overlay => !visibleOverlayIds.has(overlay.id));
  overlaysToHide.forEach(overlay => removeOverlayFromMap(overlay.id));

  // AI : Find overlays that should be visible but aren't currently rendered
  const overlaysToRender = visibleOverlays.filter(cdnOverlay => {
    const overlayObject = overlayStore.overlays[cdnOverlay.id];
    return !overlayObject || !overlayObject.overlay || !map.value!.hasLayer(overlayObject.overlay);
  });

  // AI : Recreate missing overlays from scratch
  if (overlaysToRender.length > 0) {
    renderViewModeOverlays(overlaysToRender, true, false);
    overlayStore.setViewModeOverlays(visibleOverlays);
  } else {
    overlayStore.setViewModeOverlays(visibleOverlays);
  }

  // AI : Update currentCityOverlays AND cache to ensure they're preserved
  mapStore.currentCityOverlays = cityOverlays;
  mapStore.setCityProjectsCache(selectedCityId, overlayStore.mode, cityOverlays);
}

// AI : Watch for mode changes to manage overlay state
watch(() => overlayStore.mode, (newMode, oldMode) => {
  if (newMode !== 'view' && oldMode === 'view') {
    // AI : Entering edit or moderation mode from view mode - clear view mode tracking
    overlayStore.clearViewModeOverlays();
  } else if (newMode === 'view') {
    // AI : Apply filters when entering view mode - but only if there are overlays to filter
    // AI : The mode switch already handles rendering, this is just for completion status filtering
    setTimeout(async () => {
      // AI : Only filter if there are actually overlays loaded
      if (Object.keys(overlayStore.overlays).length > 0) {
        await filterOverlaysByCompletionStatus()
      }
    }, 100);
  }
});

// AI : Watch for overlays changes to apply filters (only in view mode)
watch(() => overlayStore.overlays ? Object.keys(overlayStore.overlays).length : 0, () => {
  if (overlayStore.mode === 'view') {
    setTimeout(async () => await filterOverlaysByCompletionStatus(), 100);
  }
});

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

onUnmounted(() => {
  // AI : Clean up event listeners
  window.removeEventListener('keydown', handleKeyDown, true);
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
    await initializeCountryMarkers(); // AI : Initialize country markers by default
    initializeOverlayModes(); // AI : Initialize overlay mode system and zoom watcher
    setupMapClickToDeselect(); // AI : Setup click handler to deselect overlays when clicking map background
    window.addEventListener('keydown', handleKeyDown, true);
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
  border-color: #f59e0b; /* Orange for edit mode */
}

.moderation-mode-border {
  border-color: #3b82f6; /* Blue for moderation mode */
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

/* AI : Move Leaflet attribution above mobile drawer handle */
@media (max-width: 768px) {
  /* AI : Adjust mode indicator position on mobile to be above drawer */
  .mode-indicator {
    bottom: 5rem;
  }

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
    max-width: calc(100vw - 8rem) !important; /* AI : Leave space for scale */
    position: fixed !important;
    display: block !important;
    visibility: visible !important;
    line-height: 1.3 !important;
    white-space: normal !important; /* AI : Allow text wrapping */
    word-break: break-word !important; /* AI : Break long words if needed */
  }
  
  :deep(.leaflet-control-scale) {
    bottom: 4.5rem !important; /* AI : Same level as attribution */
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
