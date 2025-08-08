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
      <div class="control-button-container">
        <Button
          icon="pi pi-plus"
          @click="handleAddOverlayClick"
          aria-label="Add Image Overlay"
          v-tooltip.right="'Add Image Overlay'"
          class="map-control-button"
        />
      </div>
      <div class="control-button-container">
        <Button
          icon="pi pi-bars"
          @click="navigateToProjects"
          aria-haspopup="true"
          aria-controls="project_menu"
          v-tooltip.right="'Manage Projects'"
          class="map-control-button"
        />
      </div>
      <div class="control-button-container">
        <LayerControl />
      </div>

      <div class="control-button-container">
        <EditModeToggle />
      </div>
    </div>
  </div>
  <Dialog
    v-model:visible="showProjectSelector"
    header="Select a nearby project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectPicker
      @project-selected="onProjectSelected"
      :use-nearby-projects="true"
    />
  </Dialog>

  <ImageUploadDialog
    v-model:visible="showImageUploadDialog"
    @file-selected="onImageUploadFromDialog"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';

import { initializeMap, disableLeafletKeyboardEvents } from '@composables/core/useMap';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { toggleEditMode } from '@composables/overlay/useEditMode';
import { addOverlay, undo, redo } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import { navigateWithCoordinates } from '@composables/ui/useRouterNavigation';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects';
import LayerControl from '@components/map/LayerControl.vue';
import EditModeToggle from '@components/map/EditModeToggle.vue';
import ProjectPicker from '@components/project/ProjectPicker.vue';
import ImageUploadDialog from '@components/dialogs/ImageUploadDialog.vue';

// AI: Get Pinia stores
const projectStore = useProjectStore();
const overlayStore = useOverlayStore();
const { projects } = storeToRefs(projectStore);
const { 
  isEditMode,  
  showImageUploadDialog, 
  replacementOverlayId,
  pendingImageFile
} = storeToRefs(overlayStore);

// AI: Core state variables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const showProjectSelector = ref(false);
const isLoading = ref(true);

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

// AI : Handle add overlay button click - enable edit mode if in view mode, otherwise open dialog
async function handleAddOverlayClick() {
  if (!(isEditMode?.value ?? false)) {
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
  overlayStore.handleFileSelected(file);

  // AI : Always show project selector for both new overlays and replacements
  showProjectSelector.value = true;
}

// AI : Handle legacy query parameters
watch(() => route.query.overlay, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    router.replace(`/overlay/${overlayId}`);
  }
}, { immediate: true });

// AI : Watch for edit mode changes to start/stop camera tracking
watch(() => isEditMode?.value, (editMode) => {
  if (editMode) {
    // AI : Stop view mode tracking when entering edit mode
    stopCameraTracking();
  } else {
    // AI : Start view mode tracking when exiting edit mode
    startCameraTracking();
  }
});

// AI : Reset file input when dialog closes
watch(() => showProjectSelector.value, (newVal) => {
  if (!newVal) {
    overlayStore.clearPendingFile();
    // AI : Don't reset replacementOverlayId here as it's needed after project selection
  }
});

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : Check if project exists in local store, if not, try to get it from nearby projects
  if (!projects.value[projectId]) {
    try {
      // AI : Fetch nearby projects to get the selected project data
      const nearbyProjects = await fetchNearbyProjects();
      const nearbyProject = nearbyProjects.find((p: any) => p.id === projectId);

      if (nearbyProject) {
        // AI : Convert nearby project to local project format and add to store
        const localProject = {
          id: nearbyProject.id,
          name: nearbyProject.name,
          description: nearbyProject.description ?? '',
          overlayIds: [],
          color: '#007bff',
          cityId: nearbyProject.cityId,
          status: 'approved' as const,
          ownerId: nearbyProject.ownerId,
          createdAt: nearbyProject.createdAt,
          updatedAt: nearbyProject.updatedAt,
          metadata: nearbyProject.metadata,
          city: nearbyProject.city ? {
            id: nearbyProject.city.id,
            name: nearbyProject.city.name,
            countryCode: nearbyProject.city.countryCode,
            coordinates: { x: nearbyProject.city.lng, y: nearbyProject.city.lat },
            createdAt: null,
            updatedAt: new Date()
          } : undefined,
          sourceUrl: null,
          startDate: null,
          endDate: null,
          latestUpdateOn: null,
          savedRemotely: true
        };

        // AI : Add project to local store
        projects.value[projectId] = localProject;
      } else {
        console.warn('AI : Project not found in nearby projects, overlay creation may not work properly');
      }
    } catch (error) {
      console.error('AI : Error fetching nearby projects for project selection:', error);
    }
  }

  await handleFileUpload(projectId, !!replacementOverlayId.value);
}

// AI : Handle file upload by user
async function handleFileUpload(projectId: string, isReplacement: boolean = false) {
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
    try {
      if (isReplacement && replacementOverlayId.value) {
        // AI : Create replacement overlay using the standard overlay creation process
        const overlayId = await addOverlay(reader.result as string, projectId, replacementOverlayId.value);

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: 'Replacement Overlay Created',
            detail: 'Your replacement overlay has been created and is ready for editing',
            life: 3000
          });
        }
      } else {
        // AI : Regular overlay addition
        const overlayId = await addOverlay(reader.result as string, projectId);

        if (overlayId) {
          toast.add({
            severity: 'success',
            summary: 'Overlay added',
            detail: `Overlay has been added to project`,
            life: 3000
          });
        }
      }
    } catch (error) {
      console.error('Error handling file upload:', error);
      toast.add({
        severity: 'error',
        summary: 'Upload Failed',
        detail: 'Failed to process the image overlay',
        life: 3000
      });
    } finally {
      // AI : Reset state
      overlayStore.resetReplacement();
      showProjectSelector.value = false;
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

// AI : Handle toggle edit mode with loading state
async function handleToggleEditMode(newValue: boolean) {
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

/* AI : Professional control button styling using standard CSS and PrimeVue tokens */
.control-button-container {
  background-color: var(--p-surface-0);
  border-radius: 0.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  transition: all 150ms ease-out;
}

.control-button-container:hover {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.map-control-button {
  width: 44px;
  height: 44px;
  border-radius: 0.5rem;
  background: var(--p-surface-0) !important;
  color: var(--p-surface-700) !important;
  border: none !important;
  box-shadow: none !important;
  transition: all 150ms ease-out;
}

.map-control-button:hover {
  background: var(--p-surface-50) !important;
  color: var(--p-surface-800) !important;
}

.map-control-button:active {
  background: var(--p-surface-100) !important;
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
