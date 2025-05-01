<template>
  <div class="project-manager">
    <h3 class="text-xl font-bold mb-4">Project Manager</h3>

    <!-- Project List -->
    <div
      v-if="mode === 'list'"
      class="project-list"
    >
      <div class="flex flex-col gap-2 mb-4">
        <div
          v-for="project in projectsList"
          :key="project.id"
          class="project-item flex justify-between items-center p-2 border rounded-md mb-2"
          :style="{
            borderLeft: `8px solid ${project.color}`,
            boxShadow: `0 3px 6px ${project.color}50`,
            background: `linear-gradient(to right, ${project.color}10, transparent)`
          }"
        >
          <div class="flex flex-col">
            <span class="font-bold">{{ project.name }}</span>
            <span class="text-sm text-gray-500">{{ project.overlayIds.length }} overlays</span>
          </div>
          <div class="flex gap-2">
            <Button
              icon="pi pi-eye"
              class="p-button-sm"
              @click="viewProject(project.id)"
              v-tooltip.top="'View project overlays'"
            />
            <Button
              icon="pi pi-pencil"
              class="p-button-sm p-button-secondary"
              @click="editProject(project.id)"
              v-tooltip.top="'Edit project details'"
            />
            <Button
              icon="pi pi-trash"
              class="p-button-sm p-button-danger"
              @click="confirmDeleteProject(project.id)"
              v-tooltip.top="'Delete project'"
            />
          </div>
        </div>
      </div>
      <Button
        label="Create New Project"
        icon="pi pi-plus"
        class="p-button-primary w-full"
        @click="createNewProject()"
      />
    </div>

    <!-- Create/Edit Project Form -->
    <div
      v-if="mode === 'edit'"
      class="project-form"
    >
      <form @submit.prevent="saveProject">
        <div class="flex flex-col gap-3 mb-4">
          <FloatLabel>
            <InputText
              v-model="editingProject.name"
              required
            />
            <label>Project Name</label>
          </FloatLabel>

          <FloatLabel>
            <Textarea
              v-model="editingProject.description"
              rows="3"
            />
            <label>Description</label>
          </FloatLabel>

          <FloatLabel>
            <InputText v-model="editingProject.location" />
            <label>Location</label>
          </FloatLabel>

          <div class="flex gap-3">
            <div class="flex-1">
              <FloatLabel>
                <DatePicker v-model="editingProject.startDate" />
                <label>Start Date</label>
              </FloatLabel>
            </div>
            <div class="flex-1">
              <FloatLabel>
                <DatePicker v-model="editingProject.endDate" />
                <label>End Date</label>
              </FloatLabel>
            </div>
          </div>

          <div>
            <label>Project Color:</label>
            <div class="flex gap-2 mt-2">
              <div
                v-for="color in availableColors"
                :key="color"
                class="color-swatch w-8 h-8 rounded-full cursor-pointer border-2"
                :class="{ 'border-blue-500': editingProject.color === color, 'border-transparent': editingProject.color !== color }"
                :style="{ backgroundColor: color }"
                @click="editingProject.color = color"
              ></div>
            </div>
          </div>
        </div>

        <div class="flex gap-2 justify-between">
          <Button
            type="button"
            label="Cancel"
            class="p-button-outlined"
            icon="pi pi-times"
            @click="mode = 'list'"
          />
          <Button
            type="submit"
            label="Save Project"
            icon="pi pi-save"
          />
        </div>
      </form>
    </div>

    <!-- Project View Mode -->
    <div
      v-if="mode === 'view' && currentProject"
      class="project-view"
    >
      <div class="project-header mb-4">
        <h4
          class="text-lg font-bold"
          :style="{ color: currentProject.color }"
        >
          {{ currentProject.name }}
        </h4>
        <p
          v-if="currentProject.description"
          class="text-sm mb-2"
        >
          {{ currentProject.description }}
        </p>
        <div class="text-sm text-gray-600">
          <div v-if="currentProject.location">Location: {{ currentProject.location }}</div>
          <div v-if="currentProject.startDate">
            Period: {{ formatDate(currentProject.startDate) }} -
            {{ currentProject.endDate ? formatDate(currentProject.endDate) : 'Ongoing' }}
          </div>
        </div>
      </div>

      <div class="project-overlays mb-4">
        <h5 class="font-bold mb-2">Project Overlays</h5>
        <div
          v-if="projectOverlays.length === 0"
          class="text-center p-3 bg-gray-100 rounded-md"
        >
          No overlays in this project yet
        </div>
        <div
          v-else
          class="grid grid-cols-2 gap-2"
        >
          <div
            v-for="overlay in projectOverlays"
            :key="overlay.id"
            class="overlay-item p-2 border rounded-md"
            :style="{ borderLeft: `4px solid ${currentProject.color}` }"
          >
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium">{{ overlay.phase || 'Unnamed Overlay' }}</span>
              <Button
                icon="pi pi-times"
                class="p-button-text p-button-sm p-button-danger"
                @click="removeFromProject(overlay.id)"
                v-tooltip.top="'Remove from project'"
              />
            </div>
            <div class="text-xs text-gray-500">
              {{ overlay.phase || 'No phase' }}
            </div>
          </div>
        </div>
      </div>

      <div class="mb-4">
        <h5 class="font-bold mb-2">Actions</h5>
        <div class="grid grid-cols-2 gap-2">
          <Button
            label="Add Overlay"
            icon="pi pi-plus"
            class="p-button-outlined"
            @click="showAddOverlayDialog = true"
          />
          <Button
            label="Highlight All"
            icon="pi pi-eye"
            class="p-button-outlined"
            @click="toggleHighlight"
          />
        </div>
      </div>

      <Button
        label="Back to Projects"
        icon="pi pi-arrow-left"
        class="p-button-text w-full"
        @click="mode = 'list'"
      />
    </div>

    <!-- Dialog for adding overlays to project -->
    <Dialog
      v-model:visible="showAddOverlayDialog"
      header="Add Overlay to Project"
      :modal="true"
      :closable="true"
    >
      <div class="available-overlays">
        <h5 class="font-bold mb-2">Available Overlays</h5>
        <div
          v-if="availableOverlays.length === 0"
          class="text-center p-3 bg-gray-100 rounded-md"
        >
          No available overlays to add
        </div>
        <div
          v-else
          class="flex flex-col gap-2 max-h-60 overflow-y-auto"
        >
          <div
            v-for="overlay in availableOverlays"
            :key="overlay.id"
            class="overlay-item p-2 border rounded-md cursor-pointer hover:bg-gray-50"
            @click="addToProject(overlay.id)"
          >
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium">{{ overlay.phase || 'Unnamed Overlay' }}</span>
              <Button
                icon="pi pi-plus"
                class="p-button-text p-button-sm p-button-success"
                @click.stop="addToProject(overlay.id)"
                v-tooltip.top="'Add to project'"
              />
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          label="Close"
          icon="pi pi-times"
          @click="showAddOverlayDialog = false"
          class="p-button-text"
        />
      </template>
    </Dialog>

    <!-- Confirmation dialog for deleting project -->
    <Dialog
      v-model:visible="showDeleteDialog"
      header="Confirm Deletion"
      :modal="true"
      :closable="true"
    >
      <div class="p-4">
        <p>Are you sure you want to delete this project?</p>
        <p class="text-sm text-gray-500 mt-2">
          The overlays will remain but will no longer be associated with this project.
        </p>
      </div>
      <template #footer>
        <Button
          label="Cancel"
          icon="pi pi-times"
          @click="showDeleteDialog = false"
          class="p-button-text"
        />
        <Button
          label="Delete"
          icon="pi pi-trash"
          @click="deleteProject"
          class="p-button-danger"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, PropType } from 'vue';
import {
  projects,
  createProject,
  getOverlaysForProject,
  addOverlayToProjectWithId,
  removeOverlayFromProjectWithId,
  deleteProjectById,
  highlightProjectOverlays,
  clearProjectHighlight
} from '../composables/useProjects';
import { overlays } from '../composables/useOverlay';
import { useToast } from '../composables/useToast';
import type { Project, OverlayObject } from '../types';

const toast = useToast();

// Add a prop to allow opening in different modes
const props = defineProps({
  initialMode: {
    type: String as PropType<'list' | 'edit' | 'view'>,
    default: 'list'
  },
  initialAction: {
    type: String,
    default: '' // Possible values: 'create', 'view', etc.
  }
});

// Component state
const mode = ref<'list' | 'edit' | 'view'>(props.initialMode);
const editingProject = ref<Partial<Project>>({
  name: '',
  description: '',
  location: '',
  startDate: null,
  endDate: null,
  color: '#FF5733',
  overlayIds: []
});
const currentProjectId = ref<string | null>(null);
const projectOverlays = ref<OverlayObject[]>([]);
const showAddOverlayDialog = ref(false);
const showDeleteDialog = ref(false);
const projectToDelete = ref<string | null>(null);
const isHighlighted = ref(false);

// Available colors for projects
const availableColors = [
  '#FF3D00', // Bright Red-Orange
  '#2979FF', // Bright Blue
  '#00C853', // Bright Green
  '#AA00FF', // Bright Purple
  '#FFAB00', // Amber
  '#00BFA5', // Teal
  '#D500F9', // Magenta
  '#FF9100', // Dark Orange
  '#1DE9B6', // Light Teal
  '#00B0FF', // Light Blue
  '#76FF03', // Lime
  '#FF4081', // Pink
  '#F50057', // Deep Pink
  '#651FFF', // Deep Purple
  '#FFD600'  // Yellow
];

// Computed properties
const projectsList = computed(() => {
  return Object.values(projects.value);
});

const currentProject = computed(() => {
  return currentProjectId.value ? projects.value[currentProjectId.value] : null;
});

const availableOverlays = computed(() => {
  // Get all overlays that aren't part of the current project
  return Object.values(overlays.value).filter(overlay => {
    return !overlay.projectId || overlay.projectId !== currentProjectId.value;
  });
});

// Initialize component
onMounted(async () => {
  // Projects are loaded by App.vue
});

// Watch for prop changes to update mode dynamically
watch(() => props.initialMode, (newMode) => {
  if (newMode) {
    mode.value = newMode;
  }
}, { immediate: true });

// Watch for initialAction changes to trigger specific actions
watch(() => props.initialAction, (action) => {
  if (action === 'create') {
    createNewProject();
  }
}, { immediate: true });

// Watch for initialAction that includes a projectId
watch(props, async (newProps) => {
  if (newProps.initialAction && newProps.initialAction.startsWith('view:')) {
    const projectId = newProps.initialAction.split(':')[1];
    await viewProject(projectId);
  }
}, { immediate: true });

// Methods
function createNewProject() {
  editingProject.value = {
    name: '',
    description: '',
    location: '',
    startDate: null,
    endDate: null,
    color: availableColors[Math.floor(Math.random() * availableColors.length)],
    overlayIds: []
  };
  mode.value = 'edit';
}

function editProject(projectId: string) {
  const project = projects.value[projectId];
  if (!project) return;

  editingProject.value = { ...project };
  mode.value = 'edit';
}

async function saveProject() {
  if (!editingProject.value.name) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'Project name is required',
      life: 3000
    });
    return;
  }

  try {
    if (editingProject.value.id) {
      // Update existing project
      const project = projects.value[editingProject.value.id];
      if (project) {
        project.name = editingProject.value.name || project.name;
        project.description = editingProject.value.description || project.description;
        project.location = editingProject.value.location || project.location;
        project.startDate = editingProject.value.startDate ?? null;
        project.endDate = editingProject.value.endDate ?? null;
        project.color = editingProject.value.color || project.color;

        // Update project in database
        await createProject(project);

        toast.add({
          severity: 'success',
          summary: 'Project updated',
          detail: `Project "${project.name}" has been updated`,
          life: 3000
        });
      }
    } else {
      // Create new project
      await createProject({
        name: editingProject.value.name || 'New Project',
        description: editingProject.value.description || '',
        location: editingProject.value.location || '',
        startDate: editingProject.value.startDate ?? null,
        endDate: editingProject.value.endDate ?? null,
        budget: 0
      });
    }

    mode.value = 'list';
  } catch (error) {
    console.error('Error saving project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to save project',
      life: 3000
    });
  }
}

async function viewProject(projectId: string) {
  currentProjectId.value = projectId;
  mode.value = 'view';

  try {
    projectOverlays.value = await getOverlaysForProject(projectId);
  } catch (error) {
    console.error('Error loading project overlays:', error);
  }
}

async function addToProject(overlayId: string) {
  if (!currentProjectId.value) return;

  await addOverlayToProjectWithId(currentProjectId.value, overlayId);

  // Refresh overlays list
  projectOverlays.value = await getOverlaysForProject(currentProjectId.value);

  // Close dialog
  showAddOverlayDialog.value = false;
}

async function removeFromProject(overlayId: string) {
  if (!currentProjectId.value) return;

  await removeOverlayFromProjectWithId(currentProjectId.value, overlayId);

  // Refresh overlays list
  projectOverlays.value = await getOverlaysForProject(currentProjectId.value);
}

function toggleHighlight() {
  if (!currentProjectId.value) return;

  if (isHighlighted.value) {
    clearProjectHighlight(currentProjectId.value);
  } else {
    highlightProjectOverlays(currentProjectId.value);
  }

  isHighlighted.value = !isHighlighted.value;
}

function confirmDeleteProject(projectId: string) {
  projectToDelete.value = projectId;
  showDeleteDialog.value = true;
}

async function deleteProject() {
  if (!projectToDelete.value) return;

  await deleteProjectById(projectToDelete.value);

  showDeleteDialog.value = false;
  projectToDelete.value = null;

  if (mode.value === 'view' && currentProjectId.value === projectToDelete.value) {
    mode.value = 'list';
  }
}

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
}

// Cleanup on component unmount
watch(mode, (newMode) => {
  if (newMode !== 'view' && currentProjectId.value && isHighlighted.value) {
    clearProjectHighlight(currentProjectId.value);
    isHighlighted.value = false;
  }
});
</script>

<style scoped>
@import "tailwindcss";
@import "tailwindcss-primeui";

.project-manager {
  padding: 1rem;
  max-width: 500px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.color-swatch {
  transition: transform 0.2s;
}

.color-swatch:hover {
  transform: scale(1.15);
}

/* Add keyframes for pulse animation */
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  }

  70% {
    box-shadow: 0 0 0 10px rgba(255, 255, 255, 0);
  }

  100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
  }
}
</style>