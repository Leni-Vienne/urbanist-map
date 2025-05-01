<template>
  <Toast />
  <div
    id="viewerDiv"
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"
  >
    <div class="map-buttons">
      <input
        type="file"
        @change="onImageUpload"
        accept="image/png, image/jpeg, image/jpg, image/webp"
      />
      <div class="card flex">
        <Button
          icon="pi pi-bars"
          @click="projectMenuToggle"
          aria-haspopup="true"
          aria-controls="project_menu"
          v-tooltip.right="'Manage Projects'"
          class="p-button-rounded"
        />
        <ContextMenu
          ref="projectMenu"
          id="project_menu"
          :model="projectMenuItems"
        >
          <template #item="{ item, props }">
            <a v-bind="props.action">
              <span
                :class="item.icon"
                class="mr-2"
              ></span>
              <span class="font-bold">{{ item.label }}</span>
            </a>
          </template>
        </ContextMenu>
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

  <!-- Project Manager Dialog -->
  <Dialog
    v-model:visible="showProjectManager"
    header="Project Manager"
    :modal="true"
    :style="{ width: '500px' }"
    :dismissableMask="true"
    @hide="closeProjectManager"
  >
    <ProjectList v-if="currentMode === 'list'" />
    <ProjectEditor 
      v-else 
      :id="currentProjectId" 
      :mode="currentMode" 
    />
  </Dialog>

  <!-- Project Selector Dialog -->
  <Dialog
    v-model:visible="showProjectSelector"
    header="Select a project for the new overlay"
    :modal="true"
    :style="{ width: '450px' }"
  >
    <ProjectSelector @project-selected="onProjectSelected" />
  </Dialog>
</template>

<script setup lang="ts">
import 'leaflet/dist/leaflet.css';
import 'leaflet-toolbar/dist/leaflet.toolbar.css';
import "leaflet-distortableimage-updated/dist/leaflet.distortableimage.css";
import './assets/style.css'
import 'primeicons/primeicons.css'

import { ref, onMounted, getCurrentInstance, watch } from 'vue';
import { initializeDatabase, clearDatabase } from './composables/useDatabase';
import { initializeMap, disableLeafletKeyboardEvents } from './composables/useMap';
import { initializeOverlays, isEditMode, toggleEditMode } from './composables/useOverlay';
import { initializeProjects } from './composables/useProjects';
import { addOverlay, undo, redo } from './composables/useOverlayActions';
import { useToast } from './composables/useToast';
import { setAppContext } from './composables/useTools';
import { useProjectManagerDialog } from './composables/useProjectManagerDialog';
import ProjectSelector from './components/ProjectSelector.vue';
import ProjectList from './components/ProjectList.vue';
import ProjectEditor from './components/ProjectEditor.vue';

const toast = useToast();
const { 
  isVisible: showProjectManager, 
  closeProjectManager, 
  currentMode,
  currentProjectId,
  openProjectManager 
} = useProjectManagerDialog();
const projectMenu = ref();
const showProjectSelector = ref(false);
const pendingImageFile = ref<File | null>(null);

// Menu items for projects context menu
const projectMenuItems = [
  {
    label: 'Manage Projects',
    icon: 'pi pi-fw pi-cog',
    command: () => {
      openProjectManager('list');
    }
  },
  {
    label: 'Create New Project',
    icon: 'pi pi-fw pi-plus',
    command: () => {
      openProjectManager('create');
    }
  },
  { separator: true },
  {
    label: 'View All Projects',
    icon: 'pi pi-fw pi-list',
    command: () => {
      openProjectManager('list');
    }
  }
];

// Toggle project menu
function projectMenuToggle(event) {
  projectMenu.value.toggle(event);
}

onMounted(async () => {
  const app = getCurrentInstance();
  if (app) {
    setAppContext(app);
  }

  await initializeDatabase();
  await initializeMap();
  await initializeProjects();
  await initializeOverlays();

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'z') {
      undo();
    } else if (event.ctrlKey && event.key === 'y') {
      redo();
    }
  }, true);

  disableLeafletKeyboardEvents();
});

// New image upload flow that requires project selection
function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  // Store the file temporarily
  pendingImageFile.value = file;

  // Show project selector
  showProjectSelector.value = true;
}

// Handle project selection from the ProjectSelector component
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

    // Clean up
    pendingImageFile.value = null;
    showProjectSelector.value = false;

    // Reset file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

// Watch for changes in showProjectSelector to reset file input when dialog closes,
// otherwise we can't import the same file again, even if we cancel in between
watch(showProjectSelector, (newVal) => {
  if (!newVal) {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }
});
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Add a slight hover effect for the project button */
.p-button-rounded:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}

/* Style for context menu items for better visibility */
:deep(.p-menuitem-link) {
  padding: 0.75rem 1rem !important;
}

:deep(.p-menuitem-icon) {
  font-size: 1rem !important;
}
</style>
