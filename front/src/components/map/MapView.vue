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
        @click="openProjectDialog"
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
  </div>
  <Dialog
    v-model:visible="showProjectSelector"
    header="Select a nearby project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectPicker
      @project-selected="onProjectSelected"
      @create-project="openProjectDialogFromPicker"
      :use-nearby-projects="true"
      ref="projectPickerRef"
    />
  </Dialog>

  <ProjectDialog
    v-if="showProjectDialogGlobally"
    v-model:visible="showProjectDialogGlobally"
    :project="projectDialogData"
    :mode="projectDialogMode"
    :title="projectDialogMode === 'create' ? 'Create New Project' : 'Edit Project'"
    @submit="handleProjectCreated"
    @cancel="handleProjectDialogCancel"
  />

  <!-- AI : Edit forms dialogs with proper modal behavior -->
  <Dialog
    v-model:visible="showProjectEditForm"
    :modal="true"
    :closable="true"
    :draggable="false"
    header="Suggest Project Changes"
    @update:visible="closeProjectEditForm"
    class="edit-form-dialog"
  >
    <EditableProjectForm
      v-if="projectEditData && showProjectEditForm"
      :project="projectEditData"
      @close="closeProjectEditForm"
      @submitted="closeProjectEditForm"
    />
  </Dialog>

  <Dialog
    v-model:visible="showOverlayEditForm"
    :modal="true"
    :closable="true"
    :draggable="false"
    header="Suggest Overlay Changes"
    @update:visible="closeOverlayEditForm"
    class="edit-form-dialog"
  >
    <EditableOverlayForm
      v-if="overlayEditData && showOverlayEditForm"
      :overlay="overlayEditData"
      @close="closeOverlayEditForm"
      @submitted="closeOverlayEditForm"
    />
  </Dialog>

  <ImageUploadDialog
    v-model:visible="showImageUploadDialog"
    @file-selected="onImageUploadFromDialog"
  />

  <!-- AI : Auth Modal for unauthenticated users -->
  <AuthModal v-model:visible="showAuthModal" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, defineAsyncComponent } from 'vue';

import { initializeMap, disableLeafletKeyboardEvents, map } from '@composables/core/useMap';
import { initializeCameraBounds } from '@composables/map/useCameraBounds';
import { toggleEditMode } from '@composables/overlay/useEditMode';
import { addOverlay, undo, redo } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';
import { lastCreatedProjectId } from '@composables/ui/useProjectState';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { initializeCountryMarkers } from '@composables/map/useCountryMarkers';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useAuthStore } from '@stores/authStore';
import { storeToRefs } from 'pinia';
import { fetchNearbyProjects } from '@composables/project/useNearbyProjects';
import { useProjectDialogState } from '@composables/ui/useProjectDialogState';
import { useEditFormsState } from '@composables/ui/useEditFormsState';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { createButtonSVG } from '@composables/ui/colorMarkers';

import LayerControl from '@components/map/LayerControl.vue';
import EditModeToggle from '@components/map/EditModeToggle.vue';
import UserMenu from '@components/auth/UserMenu.vue';
import AuthModal from '@components/auth/AuthModal.vue';

const ProjectPicker = defineAsyncComponent(() => import('@components/project/ProjectPicker.vue'));
const ProjectDialog = defineAsyncComponent(() => import('@components/project/ProjectDialog.vue'));
const ImageUploadDialog = defineAsyncComponent(() => import('@components/dialogs/ImageUploadDialog.vue'));
const EditableProjectForm = defineAsyncComponent(() => import('@components/forms/EditableProjectForm.vue'));
const EditableOverlayForm = defineAsyncComponent(() => import('@components/forms/EditableOverlayForm.vue'));

// AI: Get Pinia stores
const projectStore = useProjectStore();
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const { projects } = storeToRefs(projectStore);
const {
  isEditMode,
  showImageUploadDialog,
  replacementOverlayId,
  pendingImageFile,
  overlays
} = storeToRefs(overlayStore);

// AI : Use global project dialog state
const { showProjectDialogGlobally, projectDialogData, projectDialogMode, openProjectDialog: openProjectDialogGlobally, closeProjectDialog } = useProjectDialogState();

// AI : Use global edit forms state
const { 
  showProjectEditForm, 
  showOverlayEditForm, 
  projectEditData, 
  overlayEditData, 
  closeProjectEditForm, 
  closeOverlayEditForm 
} = useEditFormsState();

// AI: Core state variables
const toast = useToast();
const showProjectSelector = ref(false);
const showAuthModal = ref(false);
const isLoading = ref(true);
const projectPickerRef = ref();

// AI : Overlay completion status filter state
const visibleCompletionStates = ref({
  green: true,   // Not started
  orange: true,  // In progress  
  grey: true     // Completed
});

// AI : Marker colors for the color picker buttons
const markerColors = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' }
];

// AI : Use view mode overlays for displaying overlays when camera moves
const { startCameraTracking, stopCameraTracking, renderCurrentOverlays } = useViewModeOverlays();


// AI : Open project dialog for testing
function openProjectDialog() {
  openProjectDialogGlobally();
}

// AI : Handle create-project event from ProjectPicker
function openProjectDialogFromPicker() {
  showProjectSelector.value = false;
  openProjectDialogGlobally();
}

// AI : Handle project creation/update from dialog
function handleProjectCreated(project: any) {
  closeProjectDialog();
  // AI : For creation, this will trigger the lastCreatedProjectId watcher
  // For updates, the project data will be refreshed automatically through stores
}

// AI : Handle project dialog cancel
function handleProjectDialogCancel() {
  closeProjectDialog();
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

// AI : Handle add overlay button click - check auth first
function handleAddOverlayButtonClick() {
  if (authStore.isAuthenticated) {
    handleAddOverlayClick();
  } else {
    handleUnauthenticatedAction();
  }
}

// AI : Handle unauthenticated user trying to add overlay
function handleUnauthenticatedAction() {
  showAuthModal.value = true;
}

// AI : Toggle completion status filter
function toggleCompletionFilter(status: 'green' | 'orange' | 'grey') {
  visibleCompletionStates.value[status] = !visibleCompletionStates.value[status];
  filterOverlaysByCompletionStatus();
}

// AI : Get marker SVG for button icons using button-specific SVG
function getMarkerSVG(color: 'green' | 'orange' | 'grey'): string {
  return createButtonSVG(color);
}

// AI : Filter overlays based on completion status
function filterOverlaysByCompletionStatus() {
  if (!map.value || !overlays.value) return;
  
  // AI : Get all overlay objects from the store
  const allOverlays = Object.values(overlays.value) as any[];
  
  allOverlays.forEach((overlayObject) => {
    if (overlayObject.overlay) {
      // AI : Get the completion color using the same logic as markers
      const completionColor = getOverlayMarkerColor(overlayObject, 'view');
      
      const shouldShow = visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
      
      if (shouldShow) {
        // AI : Show overlay on map if not already visible
        if (!map.value!.hasLayer(overlayObject.overlay)) {
          map.value!.addLayer(overlayObject.overlay);
        }
        // AI : Show marker if exists
        if (overlayObject.marker && !map.value!.hasLayer(overlayObject.marker)) {
          map.value!.addLayer(overlayObject.marker);
        }
      } else {
        // AI : Hide overlay from map
        if (map.value!.hasLayer(overlayObject.overlay)) {
          map.value!.removeLayer(overlayObject.overlay);
        }
        // AI : Hide marker if exists
        if (overlayObject.marker && map.value!.hasLayer(overlayObject.marker)) {
          map.value!.removeLayer(overlayObject.marker);
        }
      }
    }
  });
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

// AI : Handle file selection from dialog
async function onImageUploadFromDialog(file: File) {
  overlayStore.handleFileSelected(file);

  // AI : Show project selector for overlay workflow
  showProjectSelector.value = true;
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
    setTimeout(() => filterOverlaysByCompletionStatus(), 100);
  }
});

// AI : Watch for overlays changes to apply filters
watch(() => overlays.value ? Object.keys(overlays.value).length : 0, () => {
  if (!isEditMode?.value) {
    setTimeout(() => filterOverlaysByCompletionStatus(), 100);
  }
});

// AI : Reset file input when dialog closes, but not if we just created a project
watch(() => showProjectSelector.value, (newVal) => {
  if (!newVal && !lastCreatedProjectId.value) {
    overlayStore.clearPendingFile();
  }
});

onMounted(async () => {
  await initializeMapAndOverlays();
  isLoading.value = false;
});

// AI : Process image after project selection
async function onProjectSelected(projectId: string) {
  // AI : Clear the last created project ID since we're now proceeding with overlay creation
  lastCreatedProjectId.value = null;
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
        await addOverlay(reader.result as string, projectId);
        // AI : Don't show toast here - addOverlayToProjectWithId will show a more specific toast
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

/* AI : Simple container styling */
.zoom-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
}

.marker-colors {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

/* AI : Global CSS for custom SVG markers */
:global(.custom-svg-marker) {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}

/* AI : Edit form dialogs - ensure proper modal behavior */
:deep(.edit-form-dialog .p-dialog) {
  max-width: 90vw;
  max-height: 90vh;
  z-index: 9999;
}

:deep(.edit-form-dialog .p-dialog-content) {
  padding: 0;
}

:deep(.edit-form-dialog .p-dialog-mask) {
  z-index: 9998;
}
</style>
