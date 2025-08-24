<template>
  <div
    id="viewerDiv"
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
    <div class="user-menu-container">
      <UserMenu />
    </div>

    <!-- AI : Map Controls Component -->
    <MapControls
      @filter-overlays="filterOverlaysByCompletionStatus"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@composables/core/useMap';
import { addTileLayer } from '@composables/map/useTileLayers';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { renderViewModeOverlays, removeOverlay, undo, redo } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { currentCityOverlays, updateOverlayMarkersForFilters } from '@composables/map/useCityMarkers';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useUiStore } from '@stores/uiStore';
import { storeToRefs } from 'pinia';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';

import MapControls from '@components/map/MapControls.vue';
import UserMenu from '@components/auth/UserMenu.vue';

// AI: Get Pinia stores
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const toast = useToast();
const isLoading = ref(true);

const { isEditMode, overlays } = storeToRefs(overlayStore);

// AI : Use shared completion filter state
const { filterByCompletionStatus } = useCompletionFilters();

// AI : Use view mode overlays for displaying overlays when camera moves
const { startCameraTracking, stopCameraTracking } = useViewModeOverlays();

// AI : Filter overlays based on completion status
async function filterOverlaysByCompletionStatus() {
  if (!map.value) return;
  
  // AI : If we have overlay markers visible (when zoomed out), update them with filters
  updateOverlayMarkersForFilters();
  
  // AI : Handle full overlays (when zoomed in)
  if (!currentCityOverlays.value?.length) return;
  
  // AI : Use the shared filtering utility
  const visibleOverlays = filterByCompletionStatus(currentCityOverlays.value);
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
    await renderViewModeOverlays(overlaysToRender, true, false);
    
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
    // AI : Start view mode tracking when exiting edit mode
    startCameraTracking();
    // AI : Apply filters when entering view mode
    setTimeout(async () => await filterOverlaysByCompletionStatus(), 100);
  }
});

// AI : Watch for overlays changes to apply filters
watch(() => overlays.value ? Object.keys(overlays.value).length : 0, () => {
  if (!isEditMode?.value) {
    setTimeout(async () => await filterOverlaysByCompletionStatus(), 100);
  }
});

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
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

    // AI : Start camera tracking if in view mode
    if (!(isEditMode?.value ?? false)) {
      startCameraTracking();
    }
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

.user-menu-container {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10000;
  pointer-events: auto;
  isolation: isolate;
}


/* AI : Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}

</style>
