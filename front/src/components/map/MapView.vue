<template>
  <div class="map-wrapper">
    <!-- AI : Edit mode border overlay - separate from map container to avoid Leaflet rendering issues -->
    <div
      v-if="overlayStore.isEditMode"
      class="edit-mode-border"
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
          <p class="mt-2">Loading map and data...</p>
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
        class="mode-controls-wrapper mode-controls-desktop"
      >
        <div
          class="mode-indicator"
          :class="{ 'edit-mode': overlayStore.isEditMode }"
          v-tooltip.top="overlayStore.isEditMode ? $t('map.editModeTooltip') : $t('map.viewModeTooltip')"
        >
          <i :class="['pi', overlayStore.isEditMode ? 'pi-pencil' : 'pi-eye']"></i>
          <span>{{ overlayStore.isEditMode ? $t('map.editMode') : $t('map.viewMode') }}</span>
        </div>
        
        <button
          @click="handleModeSwitch"
          class="mode-switch-button"
          :aria-label="$t('map.switchMode')"
          v-tooltip.top="$t('map.switchMode')"
        >
          <i class="pi pi-refresh"></i>
          <span>{{ $t('map.switch') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, defineAsyncComponent } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@composables/core/useMap';
import { addTileLayer } from '@composables/map/useTileLayers';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { renderViewModeOverlays, removeOverlay, undo, redo } from '@composables/overlay/useOverlay';
import { useToast } from '@composables/ui/useToast';
import { updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useAuthStore } from '@stores/authStore';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { toggleEditMode } from '@composables/overlay/useOverlayModes';
import type { OverlayData } from '@types';

const MapControls = defineAsyncComponent(() => import('@components/map/MapControls.vue'));
const UserMenu = defineAsyncComponent(() => import('@components/auth/UserMenu.vue'));
const MarkerHelpButton = defineAsyncComponent(() => import('@components/map/MarkerHelpButton.vue'));

// AI: Get stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const isLoading = ref(true);

// AI : Filter overlays based on completion status
async function filterOverlaysByCompletionStatus() {
  if (!map.value) return;

  // AI : If we have overlay markers visible (when zoomed out), update them with filters
  updateOverlayMarkersForFilters();

  // AI : Handle full overlays (when zoomed in)
  if (!mapStore.currentCityOverlays?.length) return;

  // AI : Use the shared filtering utility
  const completionFilters = useCompletionFilters();
  const visibleOverlays = completionFilters.filterByCompletionStatus(mapStore.currentCityOverlays) as OverlayData[];
  const visibleOverlayIds = new Set(visibleOverlays.map(o => o.id));

  // AI : Remove overlays that should be hidden
  const overlaysToHide = mapStore.currentCityOverlays.filter(overlay => !visibleOverlayIds.has(overlay.id));
  overlaysToHide.forEach(overlay => removeOverlay(overlay.id));

  // AI : Find overlays that should be visible but aren't currently rendered
  const overlaysToRender = visibleOverlays.filter(cdnOverlay => {
    const overlayObject = overlayStore.overlays[cdnOverlay.id];
    return !overlayObject || !overlayObject.overlay || !map.value!.hasLayer(overlayObject.overlay);
  });

  // AI : Recreate missing overlays from scratch
  if (overlaysToRender.length > 0) {
    renderViewModeOverlays(overlaysToRender, true, false);
    overlayStore.setViewModeOverlays(visibleOverlays);
  }
}

// AI : Handle mode switch from indicator button
async function handleModeSwitch() {
  try {
    await toggleEditMode();
    
    const modeText = overlayStore.isEditMode ? 'Edit Mode' : 'View Mode';
    toast.add({
      severity: 'info',
      summary: `Switched to ${modeText}`,
      detail: overlayStore.isEditMode
        ? 'You can now add and edit overlays'
        : 'Overlays are now in view-only mode',
      life: 3000,
    });
  } catch (error) {
    console.error('Error toggling edit mode:', error);
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    });
  }
}

// AI : Watch for edit mode changes to start/stop camera tracking
watch(() => overlayStore.isEditMode, (editMode) => {
  if (editMode) {
    // AI : Stop view mode tracking when entering edit mode
    overlayStore.clearViewModeOverlays();
  } else {
    // AI : Apply filters when entering view mode
    setTimeout(async () => await filterOverlaysByCompletionStatus(), 100);
  }
});

// AI : Watch for overlays changes to apply filters
watch(() => overlayStore.overlays ? Object.keys(overlayStore.overlays).length : 0, () => {
  if (!overlayStore.isEditMode) {
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

/* AI : Edit mode border - positioned relative to map container */
.edit-mode-border {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 4px solid #f59e0b;
  pointer-events: none;
  z-index: 10000;
  animation: borderFadeIn 0.3s ease-in-out;
}

@keyframes borderFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* AI : Mode controls wrapper - 3 column grid, mode in center, button on right */
.mode-controls-wrapper {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 10001;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  pointer-events: none;
}

/* AI : Desktop only - hide on mobile since it's in the drawer */
.mode-controls-desktop {
  bottom: 1rem;
}

@media (max-width: 768px) {
  .mode-controls-desktop {
    display: none;
  }
}

/* AI : Mode indicator pill - in center column */
.mode-indicator {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-color);
  border: 2px solid var(--surface-border);
  transition: all 0.3s ease-in-out;
  pointer-events: auto;
  justify-self: center;
}

.mode-indicator.edit-mode {
  background: rgba(245, 158, 11, 0.95);
  border-color: #d97706;
  color: white;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
}

.mode-indicator i {
  font-size: 1rem;
}

/* AI : Discrete switch button - in right column at start */
.mode-switch-button {
  grid-column: 3;
  justify-self: start;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: none;
  padding: 0.35rem 0.5rem;
  margin-left: 0.5rem;
  cursor: pointer;
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  opacity: 0.7;
  transition: opacity 0.2s ease, transform 0.15s ease;
  pointer-events: auto;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.mode-switch-button:hover {
  opacity: 1;
}

.mode-switch-button:active {
  transform: scale(0.95);
}

.mode-switch-button i {
  font-size: 0.9rem;
}

.mode-switch-button span {
  text-transform: lowercase;
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
