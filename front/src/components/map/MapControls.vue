<template>
  <div
    class="map-buttons"
  >
    <!-- AI : Zoom Controls -->
    <div class="buttons-stacked">
      <Button
        @click="handleZoomIn"
        @dblclick.stop
        raised
        icon="pi pi-plus"
        aria-label="Zoom In"
        v-tooltip.right="'Zoom In'"
        severity="secondary"
      />
      <Button
        @click="handleZoomOut"
        @dblclick.stop
        raised
        icon="pi pi-minus"
        aria-label="Zoom Out"
        v-tooltip.right="'Zoom Out'"
        severity="secondary"
      />
      <Button
        @click="showHelpModal"
        @dblclick.stop
        raised
        icon="pi pi-question-circle"
        aria-label="Help"
        v-tooltip.right="'Help'"
        severity="help"
      />
    </div>

    <div class="buttons-stacked">

      <Button
        v-if="authStore.isAuthenticated"
        @click="handleAddOverlayClick"
        @dblclick.stop
        raised
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

      <LayerControl />

      <!-- AI : Edit Mode Toggle Button (inline) -->
      <Button
        v-if="authStore.isAuthenticated"
        :icon="currentIcon"
        raised
        @click="handleModeToggle"
        @dblclick.stop
        :severity="buttonSeverity"
        v-tooltip.right="tooltipText"
        aria-label="Toggle Edit Mode"
        :active="isEditMode"
      />

    </div>

    <!-- AI : Overlay Completion Status Filter Buttons (View Mode Only) -->
    <div
      v-if="!isEditMode"
      class="buttons-stacked"
    >
      <Button
        @click="toggleCompletionFilter('yellow')"
        @dblclick.stop
        raised
        :severity="visibleCompletionStates.yellow ? 'primary' : 'secondary'"
        aria-label="Toggle proposed projects"
        v-tooltip.right="'Toggle proposed projects'"
      >
        <template #icon>
          <div v-html="getMarkerSVG('yellow')"></div>
        </template>
      </Button>
      <Button
        @click="toggleCompletionFilter('green')"
        @dblclick.stop
        raised
        :severity="visibleCompletionStates.green ? 'primary' : 'secondary'"
        aria-label="Toggle not started projects"
        v-tooltip.right="'Toggle not started projects'"
      >
        <template #icon>
          <div v-html="getMarkerSVG('green')"></div>
        </template>
      </Button>
      <Button
        @click="toggleCompletionFilter('orange')"
        @dblclick.stop
        raised
        :severity="visibleCompletionStates.orange ? 'primary' : 'secondary'"
        aria-label="Toggle in progress projects"
        v-tooltip.right="'Toggle in progress projects'"
      >
        <template #icon>
          <div v-html="getMarkerSVG('orange')"></div>
        </template>
      </Button>
      <Button
        @click="toggleCompletionFilter('grey')"
        @dblclick.stop
        raised
        :severity="visibleCompletionStates.grey ? 'primary' : 'secondary'"
        aria-label="Toggle completed projects"
        v-tooltip.right="'Toggle completed projects'"
      >
        <template #icon>
          <div v-html="getMarkerSVG('grey')"></div>
        </template>
      </Button>
    </div>

    <!-- AI : Help Modal -->
    <MapHelpModal v-model="showHelp" />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useToast } from '@composables/ui/useToast';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useAuthStore } from '@stores/authStore';
import { toggleEditMode } from '@composables/overlay/useOverlayModes';
import { handleEditModeExit } from '@composables/map/useCityMarkers';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { createButtonSVG } from '@composables/ui/markerIcons';
import { map } from '@composables/core/useMap';
import LayerControl from '@components/map/LayerControl.vue';
import MapHelpModal from '@components/map/MapHelpModal.vue';
import { useAddOverlay } from '@composables/overlay/useAddOverlay';

const authStore = useAuthStore();
const overlayStore = useOverlayStore();
const toast = useToast();
const { handleAddOverlayButtonClick } = useAddOverlay();

// AI : Help modal state
const showHelp = ref(false);

const { isEditMode } = storeToRefs(overlayStore);
const { visibleCompletionStates, toggleFilter } = useCompletionFilters();

// AI : Emit events to parent for complex operations that require access to map state
const emit = defineEmits<{
  'filter-overlays': [status: 'yellow' | 'green' | 'orange' | 'grey'];
}>();

// AI : Edit mode toggle computed properties
const currentIcon = computed(() => {
  return isEditMode?.value ? 'pi pi-pencil' : 'pi pi-eye';
});

const buttonSeverity = computed(() => {
  if (isEditMode?.value) {
    return 'primary'; // Orange/yellow for edit mode
  }
  return 'secondary'; // Gray for view mode
});

const tooltipText = computed(() => {
  const currentMode = isEditMode?.value ? 'Edit Mode' : 'View Mode';
  const actionText = isEditMode?.value ? 'Switch to View Mode' : 'Switch to Edit Mode';

  // Show current state and what clicking will do
  return `Currently in ${currentMode} - Click to ${actionText.toLowerCase()}`;
});

function handleAddOverlayClick() {
  const result = handleAddOverlayButtonClick();
  
  if (result.success) {
    if (result.action === 'edit_mode_enabled') {
      toast.add({
        severity: 'info',
        summary: 'Switched to Edit Mode',
        detail: 'Click the button again to add an overlay',
        life: 4000
      });
    }
  } else if (result.reason === 'edit_mode_error') {
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    });
  }
}

// AI : Handle edit mode toggle
function handleModeToggle() {
  try {
    toggleEditMode(handleEditModeExit);

    // AI : Show toast notification for mode change
    const modeText = isEditMode?.value ? 'Edit Mode' : 'View Mode';
    toast.add({
      severity: 'info',
      summary: `Switched to ${modeText}`,
      detail: isEditMode?.value
        ? 'You can now add and edit overlays'
        : 'Overlays are now in view-only mode',
      life: 3000
    });
  } catch (error) {
    console.error('AI : Error toggling edit mode:', error);

    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    });
  }
}


// AI : Toggle completion status filter
async function toggleCompletionFilter(status: 'yellow' | 'green' | 'orange' | 'grey') {
  toggleFilter(status);
  emit('filter-overlays', status);
}

// AI : Get marker SVG for button icons using button-specific SVG
function getMarkerSVG(color: 'yellow' | 'green' | 'orange' | 'grey'): string {
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

// AI : Show help modal
function showHelpModal() {
  showHelp.value = true;
}
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: opacity 0.3s ease;
}

/* AI : Overlay completion status filter buttons */
.buttons-stacked {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
</style>