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
          @click="router.push('/projects')"
          aria-haspopup="true"
          aria-controls="project_menu"
          v-tooltip.right="'Manage Projects'"
          class="p-button-rounded"
        />
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="toggleEditMode">{{ isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode' }}</Button>
        </div>
      </div>
      <div class="card flex justify-center">
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
</template>

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance, watch, computed, inject, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { initializeMap, disableLeafletKeyboardEvents } from '@composables/useMap';
import { initializeOverlays, isEditMode, toggleEditMode } from '@composables/useOverlay';
import { addOverlay, undo, redo, navigateToOverlay } from '@composables/useOverlayActions';
import { useToast } from '@composables/useToast';
import { setAppContext } from '@composables/useTools';
import { clearDatabase } from '@composables/useDatabase';
import ProjectPicker from '@components/ProjectPicker.vue';

// AI : Core state variables
const router = useRouter();
const route = useRoute();
const toast = useToast();
const showProjectSelector = ref(false);
const pendingImageFile = ref<File | null>(null);
const databaseInitialized = inject('databaseInitialized', ref(false));
const isLoading = ref(true);

// AI : Hide buttons on non-root routes
const isRouteActive = computed(() => route.path !== '/');

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
    await initializeOverlays();
    window.addEventListener('keydown', handleKeyDown, true);
    disableLeafletKeyboardEvents();
    
    // Check for overlay ID in URL after initialization
    const overlayId = route.params.id || route.query.overlay;
    if (overlayId && typeof overlayId === 'string') {
      setTimeout(() => navigateToOverlay(overlayId as string), 100);
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

onMounted(async () => {
  const app = getCurrentInstance();
  if (app) setAppContext(app);

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
</style>