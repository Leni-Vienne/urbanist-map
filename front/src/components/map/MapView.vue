// filepath: d:\Documents\Perso\prog\city-map-overlay\src\components\MapView.vue
<template>
  <div
    id="viewerDiv"
    class="map-container"
  >
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-content">
        <i class="pi pi-spin pi-spinner text-4xl"></i>
        <p class="mt-2">Loading map and data...</p>
      </div>
    </div>
      <div class="map-buttons" :class="{ 'buttons-hidden': isRouteActive }">
      <input
        type="file"
        @change="onImageUpload"
        accept="image/png, image/jpeg, image/jpg, image/webp"
      />
      <div class="card flex">
        <Button
          icon="pi pi-bars"
          @click="navigateToProjects"
          aria-haspopup="true"
          aria-controls="project_menu"
          v-tooltip.right="'Manage Projects'"
          class="p-button-rounded"
        />
      </div>      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="handleToggleEditMode" :loading="isTogglingMode">{{ isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode' }}</Button>
        </div>
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="clearDatabase">Clear Local Storage</Button>
        </div>
      </div>
    </div>

    <!-- AI : View Mode Overlays Panel -->
    <div 
      v-if="!isEditMode && viewModeOverlays.length > 0" 
      class="view-mode-panel"
    >
      <div class="panel-header">
        <h3>Visible Overlays</h3>
        <span class="overlay-count">{{ viewModeOverlays.length }}</span>
      </div>
      <div class="panel-content">
        <div 
          v-for="overlay in viewModeOverlays" 
          :key="overlay.id"
          class="overlay-item"
        >
          <div class="overlay-info">
            <span class="overlay-phase">{{ overlay.phase }}</span>
            <span v-if="overlay.sequenceNumber" class="overlay-sequence">
              #{{ overlay.sequenceNumber }}
            </span>
          </div>
          <div class="overlay-distance">
            {{ Math.round(overlay.distance) }}m
          </div>
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
</template>

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance, watch, computed, inject, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { initializeMap, disableLeafletKeyboardEvents } from '@composables/core/useMap';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { initializeOverlays, isEditMode, toggleEditMode } from '@composables/overlay/useOverlay';
import { addOverlay, undo, redo } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import { setAppContext } from '@composables/core/useTools';
import { clearDatabase } from '@composables/core/useDatabase';
import { navigateWithCoordinates } from '@composables/ui/useRouterNavigation';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import ProjectPicker from '@components/project/ProjectPicker.vue';

// AI: Core state variables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const showProjectSelector = ref(false);
const pendingImageFile = ref<File | null>(null);
const databaseInitialized = inject('databaseInitialized', ref(false));
const isLoading = ref(true);
const isTogglingMode = ref(false);

// AI : Use view mode overlays for displaying overlays when camera moves
const { viewModeOverlays, startCameraTracking, stopCameraTracking } = useViewModeOverlays();

const isRouteActive = computed(() => route.path !== '/');

// Navigate to projects while preserving coordinates
function navigateToProjects() {
  navigateWithCoordinates('/projects');
}

// AI : Watch for route parameter changes - direct navigation without debounce
watch(() => route.params.id, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    //navigateToOverlay(overlayId, true);
  }
}, { immediate: true });

// AI : Handle legacy query parameters
watch(() => route.query.overlay, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    router.replace(`/overlay/${overlayId}`);
  }
}, { immediate: true });

// AI : Watch for edit mode changes to start/stop camera tracking
watch(isEditMode, (editMode) => {
  console.log('Edit mode changed to:', editMode);
  if (editMode) {
    // AI : Stop tracking in edit mode
    console.log('Stopping camera tracking (edit mode)');
    stopCameraTracking();
  } else {
    // AI : Start tracking in view mode
    console.log('Starting camera tracking (view mode)');
    startCameraTracking();
  }
});

// AI : Reset file input when dialog closes
watch(() => showProjectSelector.value, (newVal) => {
  if (!newVal) {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }
});

// AI : Handle image upload
function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    pendingImageFile.value = file;
    showProjectSelector.value = true;
  }
}

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
    
    // Reset file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
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
    window.addEventListener('keydown', handleKeyDown, true);
    disableLeafletKeyboardEvents();
    
    // AI : Start camera tracking if in view mode
    if (!isEditMode.value) {
      console.log('Starting camera tracking after initialization');
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
async function handleToggleEditMode() {
  isTogglingMode.value = true;
  try {
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

onMounted(async () => {
  // AI : As a backup, set app context here as well
  const app = getCurrentInstance();
  if (app) {
    console.log('Setting app context from MapView.vue (backup)');
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

.overlay-phase {
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