<template>
  <div
    class="map-buttons"
    @dblclick.stop
  >
    <Button
      @click="handleAddOverlayButtonClick"
      @dblclick.stop
      aria-label="Add Image Overlay"
      v-tooltip.right="'Add Image Overlay'"
      severity="secondary"
    >
      <template #icon>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M16 5h6" />
          <path d="M19 2v6" />
          <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          <circle
            cx="9"
            cy="9"
            r="2"
          />
        </svg>
      </template>
    </Button>
    <Button
      v-if="authStore.isAuthenticated"
      icon="pi pi-cog"
      @click="uiStore.openProjectDialog()"
      @dblclick.stop
      v-tooltip.right="'Test Project Dialog'"
      severity="secondary"
    />
    <LayerControl />

    <EditModeToggle v-if="authStore.isAuthenticated" />

    <!-- AI : Overlay Completion Status Filter Buttons (View Mode Only) -->
    <div v-if="!isEditMode" class="overlay-status-filters">
      <Button
        @click="toggleCompletionFilter('green')"
        @dblclick.stop
        :severity="visibleCompletionStates.green ? 'primary' : 'secondary'"
        aria-label="Toggle not started projects"
        v-tooltip.right="'Toggle not started projects'"
        class="status-filter-btn"
      >
        <template #icon>
          <div v-html="getMarkerSVG('green')"></div>
        </template>
      </Button>
      <Button
        @click="toggleCompletionFilter('orange')"
        @dblclick.stop
        :severity="visibleCompletionStates.orange ? 'primary' : 'secondary'"
        aria-label="Toggle in progress projects"
        v-tooltip.right="'Toggle in progress projects'"
        class="status-filter-btn"
      >
        <template #icon>
          <div v-html="getMarkerSVG('orange')"></div>
        </template>
      </Button>
      <Button
        @click="toggleCompletionFilter('grey')"
        @dblclick.stop
        :severity="visibleCompletionStates.grey ? 'primary' : 'secondary'"
        aria-label="Toggle completed projects"
        v-tooltip.right="'Toggle completed projects'"
        class="status-filter-btn"
      >
        <template #icon>
          <div v-html="getMarkerSVG('grey')"></div>
        </template>
      </Button>
    </div>

    <!-- AI : Zoom Controls -->
    <div class="zoom-controls">
      <Button
        @click="handleZoomIn"
        @dblclick.stop
        icon="pi pi-plus"
        aria-label="Zoom In"
        v-tooltip.right="'Zoom In'"
        severity="secondary"
      />
      <Button
        @click="handleZoomOut"
        @dblclick.stop
        icon="pi pi-minus"
        aria-label="Zoom Out"
        v-tooltip.right="'Zoom Out'"
        severity="secondary"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { toggleEditMode } from '@composables/overlay/useEditMode';
import { useToast } from '@composables/ui/useToast';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useAuthStore } from '@stores/authStore';
import { useUiStore } from '@stores/uiStore';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { createButtonSVG } from '@composables/ui/colorMarkers';
import { map } from '@composables/core/useMap';
import LayerControl from '@components/map/LayerControl.vue';
import EditModeToggle from '@components/map/EditModeToggle.vue';

const authStore = useAuthStore();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const toast = useToast();

const { isEditMode } = storeToRefs(overlayStore);
const { visibleCompletionStates, toggleFilter } = useCompletionFilters();

// AI : Emit events to parent for complex operations that require access to map state
const emit = defineEmits<{
  'add-overlay-clicked': [];
  'filter-overlays': [status: 'green' | 'orange' | 'grey'];
}>();

// AI : Handle add overlay button click - check auth first
function handleAddOverlayButtonClick() {
  if (authStore.isAuthenticated) {
    emit('add-overlay-clicked');
  } else {
    uiStore.openAuthModal();
  }
}

// AI : Toggle completion status filter
async function toggleCompletionFilter(status: 'green' | 'orange' | 'grey') {
  toggleFilter(status);
  emit('filter-overlays', status);
}

// AI : Get marker SVG for button icons using button-specific SVG
function getMarkerSVG(color: 'green' | 'orange' | 'grey'): string {
  return createButtonSVG(color);
}

// AI : Handle zoom in
function handleZoomIn() {
  if (map.value) {
    map.value.zoomIn();
  }
}

// AI : Handle zoom out  
function handleZoomOut() {
  if (map.value) {
    map.value.zoomOut();
  }
}
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 80px;
  left: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: opacity 0.3s ease;
}

.buttons-hidden {
  opacity: 0.2;
  pointer-events: none;
}

.buttons-hidden:hover {
  opacity: 1;
  pointer-events: auto;
}

/* AI : Simple container styling */
.zoom-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
}

/* AI : Overlay completion status filter buttons */
.overlay-status-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.status-filter-btn {
  min-width: 40px;
  min-height: 40px;
}

.status-filter-btn :deep(svg) {
  display: block;
  margin: auto;
}
</style>