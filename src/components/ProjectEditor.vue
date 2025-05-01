<template>
  <form
    v-if="mode === 'edit' || mode === 'create'"
    @submit.prevent="saveProject"
    class="project-editor"
  >
    <div class="flex flex-col gap-8 mb-4">
      <div class="field mb-6">
        <FloatLabel
          class="w-full"
          variant="in"
        >
          <InputText
            v-model="editingProject.name"
            required
            class="w-full p-3"
          />
          <label class="text-gray-600">Project Name</label>
        </FloatLabel>
      </div>

      <div class="field mb-6">
        <FloatLabel
          class="w-full"
          variant="in"
        >
          <Textarea
            v-model="editingProject.description"
            rows="3"
            class="w-full p-3 min-h-[120px]"
          />
          <label class="text-gray-600">Description</label>
        </FloatLabel>
      </div>

      <div class="field mb-6">
        <FloatLabel
          class="w-full"
          variant="in"
        >
          <InputText
            v-model="editingProject.location"
            class="w-full p-3"
          />
          <label class="text-gray-600">Location</label>
        </FloatLabel>
      </div>

      <div class="field mb-6">
        <FloatLabel
          class="w-full"
          variant="in"
        >
          <InputText
            v-model="editingProject.sourceUrl"
            class="w-full p-3"
          />
          <label class="text-gray-600">Source URL</label>
        </FloatLabel>
      </div>

      <div class="flex gap-3">
        <div class="flex-1 field mb-6">
          <FloatLabel
            class="w-full"
            variant="in"
          >
            <DatePicker
              v-model="editingProject.startDate"
              class="w-full"
            />
            <label class="text-gray-600">Start Date</label>
          </FloatLabel>
        </div>
        <div class="flex-1 field mb-6">
          <FloatLabel
            class="w-full"
            variant="in"
          >
            <DatePicker
              v-model="editingProject.endDate"
              class="w-full"
            />
            <label class="text-gray-600">End Date</label>
          </FloatLabel>
        </div>
      </div>
    </div>
    <br>
    <div class="flex gap-2 justify-center mt-8 pt-6">
      <Button
        type="button"
        label="Cancel"
        class="p-button-outlined"
        icon="pi pi-times"
        @click="closeProjectManager"
      />
      &nbsp;
      <Button
        type="submit"
        label="Save Project"
        icon="pi pi-save"
      />
    </div>
  </form>

  <!-- Project View Mode -->
  <div
    v-if="mode === 'view' && currentProject"
    class="project-view"
  >
    <div class="project-header mb-4">
      <h4 class="text-lg font-bold">{{ currentProject.name }}</h4>
      <p
        v-if="currentProject.description"
        class="text-sm mb-2"
      >
        {{ currentProject.description }}
      </p>
      <div class="text-sm text-gray-600">
        <div v-if="currentProject.location">Location: {{ currentProject.location }}</div>
        <div v-if="currentProject.sourceUrl">
          Source: <a
            :href="currentProject.sourceUrl"
            target="_blank"
            class="text-blue-600 hover:underline"
          >{{ currentProject.sourceUrl }}</a>
        </div>
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
      @click="goBackToProjects"
    />
  </div>

  <!-- Dialog for adding overlays to project -->
  <Dialog
    v-model:visible="showAddOverlayDialog"
    header="Add Overlay to Project"
    :modal="true"
    :closable="true"
    @hide="() => { showAddOverlayDialog = false; closeProjectManager(); }"
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
        @click="() => { showAddOverlayDialog = false; closeProjectManager(); }"
        class="p-button-text"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  projects,
  createProject,
  getOverlaysForProject,
  addOverlayToProjectWithId,
  removeOverlayFromProjectWithId,
  highlightProjectOverlays,
  clearProjectHighlight
} from '../composables/useProjects';
import { overlays } from '../composables/useOverlay';
import { useToast } from '../composables/useToast';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
import type { Project, OverlayObject } from '../types';

const props = defineProps<{
  id?: string;
  mode: 'edit' | 'view' | 'create';
}>();

const toast = useToast();
const { initialProjectName, closeProjectManager, openProjectManager } = useProjectManagerDialog();

// Component state
const mode = computed(() => props.mode);
const projectId = computed(() => props.id || '');

const editingProject = ref<Partial<Project>>({
  name: '',
  description: '',
  location: '',
  startDate: null,
  endDate: null,
  sourceUrl: '',
  overlayIds: [],
});

const projectOverlays = ref<OverlayObject[]>([]);
const showAddOverlayDialog = ref(false);
const isHighlighted = ref(false);

// Initialize component with route params
watch([projectId, mode], async ([newId, newMode]) => {
  if (newMode === 'create') {
    editingProject.value = {
      name: initialProjectName.value,
      description: '',
      location: '',
      startDate: null,
      endDate: null,
      sourceUrl: '',
      overlayIds: [],
    };
  } else if (newId && projects.value[newId]) {
    if (newMode === 'edit') {
      editingProject.value = { ...projects.value[newId] };
    } else if (newMode === 'view') {
      projectOverlays.value = await getOverlaysForProject(newId);
    }
  }
}, { immediate: true });

// Computed properties
const currentProject = computed(() => {
  return projectId.value ? projects.value[projectId.value] : null;
});

const availableOverlays = computed(() => {
  return Object.values(overlays.value).filter(overlay => {
    return !overlay.projectId || overlay.projectId !== projectId.value;
  });
});

// Methods
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
        Object.assign(project, {
          name: editingProject.value.name,
          description: editingProject.value.description,
          location: editingProject.value.location,
          startDate: editingProject.value.startDate ?? null,
          endDate: editingProject.value.endDate ?? null,
          sourceUrl: editingProject.value.sourceUrl
        });

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
        name: editingProject.value.name,
        description: editingProject.value.description || '',
        location: editingProject.value.location || '',
        startDate: editingProject.value.startDate ?? null,
        endDate: editingProject.value.endDate ?? null,
        budget: 0,
        sourceUrl: editingProject.value.sourceUrl || ''
      });
      toast.add({
        severity: 'success',
        summary: 'Project created',
        detail: `Project "${editingProject.value.name}" has been created`,
        life: 3000
      });
    }
    
    // After successful save, go back to the project list
    openProjectManager('list');
  } catch (error) {
    console.error('Error saving project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to save project',
      life: 3000
    });
    return;
  }
}

async function addToProject(overlayId: string) {
  if (!projectId.value) return;

  await addOverlayToProjectWithId(projectId.value, overlayId);
  projectOverlays.value = await getOverlaysForProject(projectId.value);
  showAddOverlayDialog.value = false;
}

async function removeFromProject(overlayId: string) {
  if (!projectId.value) return;

  await removeOverlayFromProjectWithId(projectId.value, overlayId);
  projectOverlays.value = await getOverlaysForProject(projectId.value);
}

function toggleHighlight() {
  if (!projectId.value) return;

  if (isHighlighted.value) {
    clearProjectHighlight(projectId.value);
  } else {
    highlightProjectOverlays(projectId.value);
  }

  isHighlighted.value = !isHighlighted.value;
}

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
}

function goBackToProjects() {
  closeProjectManager();
}

// Cleanup on component unmount
watch(() => mode.value, (newMode) => {
  if (newMode !== 'view' && projectId.value && isHighlighted.value) {
    clearProjectHighlight(projectId.value);
    isHighlighted.value = false;
  }
});
</script>

<style scoped>
@import "tailwindcss";

</style>