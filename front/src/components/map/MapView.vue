// filepath: d:\Documents\Perso\prog\city-map-overlay\src\components\MapView.vue
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
    <div
      class="map-buttons"
      :class="{ 'buttons-hidden': isRouteActive }"
    >
      <div class="card flex">
        <Button
          icon="pi pi-plus"
          @click="handleAddOverlayClick"
          aria-label="Add Image Overlay"
          v-tooltip.right="'Add Image Overlay'"
          class="p-button-rounded"
        />
      </div>
      <div class="card flex">
        <Button
          icon="pi pi-bars"
          @click="navigateToProjects"
          aria-haspopup="true"
          aria-controls="project_menu"
          v-tooltip.right="'Manage Projects'"
          class="p-button-rounded"
        />
      </div>
      <div class="card flex">
        <TileLayerSelector />
      </div>

      <div class="card flex">
        <CityMarkersToggle />
      </div>

      <div class="card flex">
        <SelectButton
          :model-value="isEditMode ? 'edit' : 'view'"
          @update:model-value="handleModeChange"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          :disabled="isEditModeDisabled"
          v-tooltip.top="isEditModeDisabled ? 'Zoom in closer to enable edit mode' : ''"
        />
      </div>
      <div class="card flex">
        <div class="w-56">
          <Button @click="clearDatabase">Clear Local Storage</Button>
        </div>
      </div>
    </div>
  </div>
  <Dialog
    v-model:visible="showProjectSelector"
    header="Select a project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectPicker @project-selected="onProjectSelected" />
  </Dialog>

  <ImageUploadDialog
    v-model:visible="showImageUploadDialog"
    @file-selected="onImageUploadFromDialog"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance, watch, computed, inject, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';

import { initializeMap, disableLeafletKeyboardEvents, currentZoomLevel } from '@composables/core/useMap';
import { initializeCameraBounds, getCameraBounds } from '@composables/map/useCameraBounds';
import { initializeOverlays, isEditMode, toggleEditMode } from '@composables/overlay/useOverlay';
import { addOverlay, undo, redo } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import { setAppContext } from '@composables/core/useTools';
import { clearDatabase } from '@composables/core/useDatabase';
import { navigateWithCoordinates } from '@composables/ui/useRouterNavigation';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { initializeCityMarkers } from '@composables/map/useCityMarkers';
import { loadProjectsNearLocation } from '@composables/project/useProjects';
import TileLayerSelector from '@components/map/TileLayerSelector.vue';
import CityMarkersToggle from '@components/map/CityMarkersToggle.vue';
import ProjectPicker from '@components/project/ProjectPicker.vue';
import ImageUploadDialog from '@components/dialogs/ImageUploadDialog.vue';

// AI: Core state variables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const showProjectSelector = ref(false);
const showImageUploadDialog = ref(false);
const pendingImageFile = ref<File | null>(null);
const databaseInitialized = inject('databaseInitialized', ref(false));
const isLoading = ref(true);
const isTogglingMode = ref(false);

// AI : Options for the mode SelectButton
const modeOptions = [
  { label: 'View Mode', value: 'view' },
  { label: 'Edit Mode', value: 'edit' }
];

// AI : Computed property to determine if edit mode should be disabled
const isEditModeDisabled = computed(() => {
  return currentZoomLevel.value < 9 && !isEditMode.value;
});

// AI : Use view mode overlays for displaying overlays when camera moves
const { startCameraTracking, stopCameraTracking } = useViewModeOverlays();

const isRouteActive = computed(() => route.path !== '/' && !route.path.startsWith('/overlay'));

// Navigate to projects while preserving coordinates
function navigateToProjects() {
  navigateWithCoordinates('/projects');
}

// AI : Open image upload dialog
function openImageUploadDialog() {
  showImageUploadDialog.value = true;
}

// AI : Handle mode change from SelectButton
async function handleModeChange(newMode: string) {
  const shouldBeEditMode = newMode === 'edit';
  if (shouldBeEditMode !== isEditMode.value) {
    await handleToggleEditMode(shouldBeEditMode);
  }
}

// AI : Handle add overlay button click - enable edit mode if in view mode, otherwise open dialog
async function handleAddOverlayClick() {
  if (!isEditMode.value) {
    // AI : Enable edit mode first if currently in view mode
    await handleToggleEditMode(true);
    // AI : Show toast notification to inform user about mode switch
    toast.add({
      severity: 'info',
      summary: 'Switched to Edit Mode',
      detail: 'Click the button again to add an overlay',
      life: 4000
    });
  } else {
    // AI : Already in edit mode, open the dialog
    openImageUploadDialog();
  }
}

// AI : Handle file selection from dialog
async function onImageUploadFromDialog(file: File) {
  pendingImageFile.value = file;

  // AI : Load projects near current camera location when uploading overlay
  const cameraBounds = getCameraBounds();
  if (cameraBounds.value) {
    const centerLat = (cameraBounds.value.north + cameraBounds.value.south) / 2;
    const centerLng = (cameraBounds.value.east + cameraBounds.value.west) / 2;
    await loadProjectsNearLocation(centerLat, centerLng, 10);
  }

  showProjectSelector.value = true;
}

// AI : Handle legacy query parameters
watch(() => route.query.overlay, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    router.replace(`/overlay/${overlayId}`);
  }
}, { immediate: true });

// AI : Watch for edit mode changes to start/stop camera tracking
watch(isEditMode, (editMode) => {
  if (editMode) {
    // AI : Stop tracking in edit mode

    stopCameraTracking();
  } else {
    // AI : Start tracking in view mode
    startCameraTracking();
  }
});

// AI : Reset file input when dialog closes
watch(() => showProjectSelector.value, (newVal) => {
  if (!newVal) {
    pendingImageFile.value = null;
  }
});

onMounted(async () => {
  // AI : As a backup, set app context here as well
  const app = getCurrentInstance();
  if (app) {
    setAppContext(app);
  }

  if (!databaseInitialized.value) {
    // Wait for database initialization
    const unwatch = watch(databaseInitialized, async (initialized) => {
      if (initialized) {
        unwatch();
        await initializeMapAndOverlays();
        isLoading.value = false;
      }
    });
  } else {
    // Database already initialized
    await initializeMapAndOverlays();
    isLoading.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown, true);
});

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  await handleFileUpload(projectId);
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string) {
  if (!pendingImageFile.value) {
    console.warn('No image file to upload');
    toast.add({
      severity: 'warn',
      summary: 'No file selected',
      detail: 'Please select an image file to upload',
      life: 3000
    });
    showProjectSelector.value = false;
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const overlayId = await addOverlay(reader.result as string, projectId);
    pendingImageFile.value = null;
    showProjectSelector.value = false;

    // Add success message
    if (overlayId) {
      toast.add({
        severity: 'success',
        summary: 'Overlay added',
        detail: `Overlay has been added to project`,
        life: 3000
      });
    }
  };
  reader.readAsDataURL(pendingImageFile.value);
}

// AI : Keyboard shortcuts handler
function handleKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'z') undo();
  else if (event.ctrlKey && event.key === 'y') redo();
}

// AI : Initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    await initializeMap();
    initializeCameraBounds(); // AI : Initialize camera bounds tracking
    await initializeOverlays();
    await initializeCityMarkers(); // AI : Initialize city markers by default
    window.addEventListener('keydown', handleKeyDown, true);
    disableLeafletKeyboardEvents();

    // AI : Start camera tracking if in view mode
    if (!isEditMode.value) {
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

// AI : Handle toggle edit mode with loading state
async function handleToggleEditMode(newValue: boolean) {
  isTogglingMode.value = true;
  try {
    // AI : Ensure database is initialized before toggling mode
    if (!databaseInitialized.value) {
      console.warn('AI : Database not initialized, waiting...');
      toast.add({
        severity: 'warn',
        summary: 'Please Wait',
        detail: 'Database is still initializing...',
        life: 3000
      });
      // AI : Revert the toggle if database not ready
      return;
    }

    await toggleEditMode();
  } catch (error) {
    console.error('AI : Error toggling edit mode:', error);
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    });
  } finally {
    isTogglingMode.value = false;
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

.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.p-button-rounded:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
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

.view-mode-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 300px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #495057;
}

.overlay-count {
  background: #007bff;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.panel-content {
  max-height: 400px;
  overflow-y: auto;
}

.overlay-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #f1f3f4;
}

.overlay-item:last-child {
  border-bottom: none;
}

.overlay-item:hover {
  background: #f8f9fa;
}

.overlay-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.overlay-caption {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.overlay-sequence {
  font-size: 11px;
  color: #6c757d;
}

.overlay-distance {
  font-size: 12px;
  color: #28a745;
  font-weight: 500;
}
</style>