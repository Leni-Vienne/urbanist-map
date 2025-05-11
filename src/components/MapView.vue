// filepath: d:\Documents\Perso\prog\city-map-overlay\src\components\MapView.vue
<template>
  <div
    id="viewerDiv"
    class="map-container"
  >
    <!-- AI : Loading overlay while database and map are initializing -->
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
          @click="openProjectsMenu"
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

  <!-- Project Selector Dialog -->
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
import { initializeMap, disableLeafletKeyboardEvents } from '../composables/useMap';
import { initializeOverlays, isEditMode, toggleEditMode } from '../composables/useOverlay';
import { addOverlay, undo, redo, navigateToOverlay } from '../composables/useOverlayActions';
import { useToast } from '../composables/useToast';
import { setAppContext } from '../composables/useTools';
import { clearDatabase } from '../composables/useDatabase';
import { debounce } from '../utils';
import ProjectPicker from './ProjectPicker.vue';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';

// AI : Get router instance
const router = useRouter();
const route = useRoute();
const toast = useToast();
const showProjectSelector = ref(false);
const pendingImageFile = ref<File | null>(null);
// AI : Get database initialization state from App.vue
const databaseInitialized = inject('databaseInitialized', ref(false));
// AI : Loading state to show while waiting for initialization
const isLoading = ref(true);
// AI : Flag to track if URL change was from a direct overlay click
const isUrlChangeFromClick = ref(false);
// AI : Track last processed overlay to prevent loops
const lastProcessedOverlayId = ref<string | null>(null);
// AI : Track timestamp of last navigation to prevent rapid changes
const lastNavigationTimestamp = ref(Date.now());
// AI : Navigation cooldown in milliseconds
const NAVIGATION_COOLDOWN = 500;
// AI : Get project manager dialog composable
const { openProjectManager } = useProjectManagerDialog();

// AI : Expose this flag to other components
if (window) {
  window.isUrlChangeFromClick = isUrlChangeFromClick;
}

// AI : Check if we're on a route where we should hide the map buttons
const isRouteActive = computed(() => {
  return route.path !== '/';
});

// AI : Create a debounced version of navigation to prevent rapid camera movements
const debouncedNavigate = debounce((overlayId: string, centerMap: boolean) => {
  // AI : Check if we're already processing this overlay to prevent loops
  if (lastProcessedOverlayId.value === overlayId) {
    console.log('AI: Skipping navigation - already processing this overlay');
    return;
  }
  
  // AI : Check if we're navigating too quickly
  const now = Date.now();
  if (now - lastNavigationTimestamp.value < NAVIGATION_COOLDOWN) {
    console.log('AI: Skipping navigation - too soon after last navigation');
    return;
  }
  
  // AI : Update tracking variables
  lastProcessedOverlayId.value = overlayId;
  lastNavigationTimestamp.value = now;
  
  // AI : Navigate to the overlay
  navigateToOverlay(overlayId, centerMap);
  
  // AI : Reset the click flag after processing
  isUrlChangeFromClick.value = false;
  
  // AI : Reset the processed ID after a delay
  setTimeout(() => {
    if (lastProcessedOverlayId.value === overlayId) {
      lastProcessedOverlayId.value = null;
    }
  }, NAVIGATION_COOLDOWN);
}, 250);

// AI : Watch for route parameters for overlay selection
watch(() => route.params.id, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    console.log('AI: URL overlay path parameter changed to:', overlayId);
    
    // AI : Use debounced navigation with anti-loop protection
    debouncedNavigate(overlayId, !isUrlChangeFromClick.value);
  }
}, { immediate: true });

// AI : Watch for legacy query parameters for backward compatibility
watch(() => route.query.overlay, (overlayId) => {
  if (overlayId && typeof overlayId === 'string' && !isLoading.value) {
    // AI : Redirect to the new path format
    console.log('AI: Legacy query parameter detected, redirecting to path format');
    
    // AI : Set the flag to prevent centering when the URL is updated
    isUrlChangeFromClick.value = true;
    router.replace(`/overlay/${overlayId}`);
  }
}, { immediate: true });

// Watch for changes in showProjectSelector to reset file input when dialog closes
watch(() => showProjectSelector.value, (newVal) => {
  if (!newVal) {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }
});

// AI : Image upload flow with project selection
function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  // AI : Store the file temporarily
  pendingImageFile.value = file;

  // AI : Show project selector
  showProjectSelector.value = true;
}

// AI : Open the projects manager
function openProjectsMenu() {
  // AI : Use router navigation to go to the projects page
  router.push('/projects');
}

// AI : Handle project selection from the ProjectSelector component
async function onProjectSelected(projectId: string) {
  if (!pendingImageFile.value) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'No image file to upload',
      life: 3000
    });
    showProjectSelector.value = false;
    return;
  }

  const file = pendingImageFile.value;

  const reader = new FileReader();
  reader.onload = async () => {
    const imageUrl = reader.result as string;
    await addOverlay(imageUrl, projectId);

    // AI : Clean up
    pendingImageFile.value = null;
    showProjectSelector.value = false;

    // AI : Reset file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

onMounted(async () => {
  const app = getCurrentInstance();
  if (app) {
    setAppContext(app);
  }

  // AI : Wait for database to be initialized
  if (!databaseInitialized.value) {
    console.log('Waiting for database to be initialized before initializing map...');
    isLoading.value = true;
    
    // AI : Watch for database initialization
    const unwatch = watch(databaseInitialized, async (initialized) => {
      if (initialized) {
        console.log('Database now initialized, continuing map initialization');
        unwatch(); // Stop watching once initialized
        await initializeMapAndOverlays();
        isLoading.value = false;
        
        // AI : Check for overlay ID in URL after initialization
        if (route.query.overlay && typeof route.query.overlay === 'string') {
          setTimeout(() => {
            navigateToOverlay(route.query.overlay as string);
          }, 100);
        }
      }
    });
  } else {
    // AI : Database already initialized, proceed directly
    console.log('Database already initialized, proceeding with map initialization');
    await initializeMapAndOverlays();
    isLoading.value = false;
    
    // AI : Check for overlay ID in URL after initialization
    if (route.query.overlay && typeof route.query.overlay === 'string') {
      setTimeout(() => {
        navigateToOverlay(route.query.overlay as string);
      }, 100);
    }
  }
});

// AI : Clean up when component is unmounted
onBeforeUnmount(() => {
  // AI : Remove event listeners
  window.removeEventListener('keydown', handleKeyDown, true);
});

// AI : Handle keyboard shortcuts
function handleKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'z') {
    undo();
  } else if (event.ctrlKey && event.key === 'y') {
    redo();
  }
}

// AI : Separate function to initialize map and overlays
async function initializeMapAndOverlays() {
  try {
    console.log('Initializing map...');
    await initializeMap();
    console.log('Map initialized');
    
    console.log('Initializing overlays...');
    await initializeOverlays();
    console.log('Overlays initialized');
    
    // AI : Set up keyboard event listeners
    window.addEventListener('keydown', handleKeyDown, true);

    disableLeafletKeyboardEvents();
    console.log('Map and overlays initialization complete');
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
  z-index: 1; /* AI : Ensure map stays behind dialogs */
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

/* Add a slight hover effect for the project button */
.p-button-rounded:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}

/* AI : Loading overlay styles */
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