<template>
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
        <p class="mt-2">Loading map and data...</p>
      </div>
    </div>
    <!-- AI : User Menu in top-right corner -->
    <UserMenu />

    <!-- AI : Map Controls Component -->
    <MapControls @filter-overlays="filterOverlaysByCompletionStatus" />
    
    <!-- AI : Project Info Popup Container -->
    <PopupContainer mode="project" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@composables/core/useMap';
import { addTileLayer } from '@composables/map/useTileLayers';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { renderViewModeOverlays, removeOverlay, undo, redo } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useViewModeOverlays } from '@composables/overlay/useOverlayModes';
import { currentCityOverlays, updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useUiStore } from '@stores/uiStore';
import { storeToRefs } from 'pinia';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import type { CDNOverlayData } from '@types';

import MapControls from '@components/map/MapControls.vue';
import UserMenu from '@components/auth/UserMenu.vue';
import PopupContainer from '@components/map/PopupContainer.vue';

// AI: Get Pinia stores
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const toast = useToast();
const isLoading = ref(true);


const { isEditMode, overlays } = storeToRefs(overlayStore);

// AI : Use view mode overlays for displaying overlays when camera moves
const { stopCameraTracking } = useViewModeOverlays();

// AI : Filter overlays based on completion status
async function filterOverlaysByCompletionStatus() {
  if (!map.value) return;

  // AI : If we have overlay markers visible (when zoomed out), update them with filters
  updateOverlayMarkersForFilters();

  // AI : Handle full overlays (when zoomed in)
  if (!currentCityOverlays.value?.length) return;

  // AI : Use the shared filtering utility
  // AI : Use shared completion filter state
  const completionFilters = useCompletionFilters();
  const visibleOverlays = completionFilters.filterByCompletionStatus(currentCityOverlays.value) as CDNOverlayData[];
  const visibleOverlayIds = new Set(visibleOverlays.map(o => o.id));

  // AI : Remove overlays that should be hidden
  const overlaysToHide = currentCityOverlays.value.filter(overlay => !visibleOverlayIds.has(overlay.id));
  overlaysToHide.forEach(overlay => removeOverlay(overlay.id));

  // AI : Find overlays that should be visible but aren't currently rendered
  const overlaysToRender = visibleOverlays.filter(cdnOverlay => {
    const overlayObject = overlays.value[cdnOverlay.id];
    return !overlayObject || !overlayObject.overlay || !map.value!.hasLayer(overlayObject.overlay);
  });

  // AI : Recreate missing overlays from scratch
  if (overlaysToRender.length > 0) {
    renderViewModeOverlays(overlaysToRender, true, false);

    // AI : Update view mode tracking with currently visible overlays
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays(visibleOverlays);
  }
}

// AI : Watch for edit mode changes to start/stop camera tracking
watch(() => isEditMode?.value, (editMode) => {
  if (editMode) {
    // AI : Stop view mode tracking when entering edit mode
    stopCameraTracking();
  } else {
    // AI : Apply filters when entering view mode //TODO may not work on slow internet
    setTimeout(async () => await filterOverlaysByCompletionStatus(), 100);
  }
});

// AI : Watch for overlays changes to apply filters //TODO may not work on slow internet
watch(() => overlays.value ? Object.keys(overlays.value).length : 0, () => {
  if (!isEditMode?.value) {
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
  if (event.ctrlKey && event.key === 'z') undo();
  else if (event.ctrlKey && event.key === 'y') redo();
}


// AI : Initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    await initializeMap();
    addTileLayer(); // AI : Initialize tile layers after map is created
    initializeCameraBounds(); // AI : Initialize camera bounds tracking
    await initializeCountryMarkers(); // AI : Initialize country markers by default
    window.addEventListener('keydown', handleKeyDown, true);
    disableLeafletKeyboardEvents();

  } catch (error) {
    console.error('Error initializing map and overlays:', error);
    toast.add({
      severity: 'error',
      summary: 'Initialization Error',
      detail: 'Failed to initialize map and overlays',
      life: 5000
    });
  }
}

</script>

<style scoped>
.map-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
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
  background-color: rgba(255, 255, 255, 0.8);
  z-index: 1000;
}

.loading-content {
  text-align: center;
}

/* AI : Move Leaflet attribution above mobile drawer handle */
@media (max-width: 768px) {
  :deep(.leaflet-control-attribution) {
    bottom: 4.5rem !important;
    right: 0.5rem !important;
    left: auto !important;
    z-index: 1010 !important;
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
    z-index: 1010 !important;
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
