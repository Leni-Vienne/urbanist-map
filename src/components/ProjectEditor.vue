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
        @click="goBack()"
      />
      &nbsp;
      <Button
        type="submit"
        :label="mode === 'create' ? 'Create project' : 'Update project'"
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

    <!-- AI : Display a summary of project overlays -->
    <div class="mb-4">
      <div class="flex justify-between items-center mb-2">
        <h5 class="font-bold">Project Overlays</h5>
        <span class="text-sm bg-gray-200 px-2 py-1 rounded-full">
          {{ currentProject.overlayIds.length }} overlays
        </span>
      </div>
      
      <div 
        v-if="currentProject.overlayIds.length === 0"
        class="text-center p-3 bg-gray-100 rounded-md"
      >
        No overlays in this project yet
      </div>
      
      <div 
        v-else
        class="text-center p-3 bg-gray-100 rounded-md"
      >
        This project contains {{ currentProject.overlayIds.length }} overlay{{ currentProject.overlayIds.length > 1 ? 's' : '' }}.
        <Button
          label="View All Overlays"
          icon="pi pi-list"
          class="p-button-text p-button-sm mt-2"
          @click="viewAllOverlays"
        />
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
        <Button
          label="Edit Project"
          icon="pi pi-pencil"
          class="p-button-outlined p-button-info col-span-2"
          @click="editFromView()"
        />
      </div>
    </div>

    <Button
      label="Back to Projects"
      icon="pi pi-arrow-left"
      title="salut"
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
    @hide="() => { showAddOverlayDialog = false; }"
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
        @click="() => { showAddOverlayDialog = false; }"
        class="p-button-text"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  projects,
  createProject,
  getOverlaysForProject,
  addOverlayToProjectWithId,
  removeOverlayFromProjectWithId,
  highlightProjectOverlays,
  clearProjectHighlight,
  updateProject
} from '@composables/useProjects';
import { overlays } from '@composables/useOverlay';
import { navigateToOverlay } from '@composables/useOverlayActions';
import { useToast } from '@composables/useToast';
import { initialProjectName, setLastCreatedProject, goBack } from '@composables/useRouterNavigation';
import type { Project, OverlayObject, OverlayListItem } from '@types';
import ProjectOverlaysList from './ProjectOverlaysList.vue';

const props = defineProps<{
  id?: string;
  mode: 'edit' | 'view' | 'create';
}>();

const router = useRouter();
const route = useRoute();
const toast = useToast();

// AI : Component state
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

// AI : Store the full overlay objects
const fullProjectOverlays = ref<OverlayObject[]>([]);

// AI : Simplified overlay items for the list component
const projectOverlays = computed<OverlayListItem[]>(() => {
  return fullProjectOverlays.value.map(overlay => ({
    id: overlay.id,
    phase: overlay.phase,
    sequenceNumber: overlay.sequenceNumber
  }));
});

const showAddOverlayDialog = ref(false);
const isHighlighted = ref(false);

// AI : Computed properties
const currentProject = computed(() => projectId.value ? projects.value[projectId.value] : null);

const availableOverlays = computed(() => 
  Object.values(overlays.value).filter(overlay => 
    !overlay.projectId || overlay.projectId !== projectId.value
  )
);

// AI : Initialize component with route params
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
    editingProject.value = newMode === 'edit' ? { ...projects.value[newId] } : editingProject.value;
    
    if (newMode === 'view') {
      fullProjectOverlays.value = await getOverlaysForProject(newId);
    }
  }
}, { immediate: true });

// AI : Clean up highlight when mode changes or component unmounts
watch(() => mode.value, (newMode) => {
  if (newMode !== 'view' && projectId.value && isHighlighted.value) {
    clearProjectHighlight(projectId.value);
    isHighlighted.value = false;
  }
});

onBeforeUnmount(() => {
  if (isHighlighted.value && projectId.value) {
    clearProjectHighlight(projectId.value);
  }
});

// AI : Methods
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
    const isExisting = !!editingProject.value.id;
    const projectData = {
      name: editingProject.value.name,
      description: editingProject.value.description || '',
      location: editingProject.value.location || '',
      startDate: editingProject.value.startDate ?? null,
      endDate: editingProject.value.endDate ?? null,
      sourceUrl: editingProject.value.sourceUrl || '',
      budget: 0 // AI: Ensure budget is always a number
    };
    
    let projectId;
    if (isExisting) {
      await updateProject(editingProject.value.id!, projectData);
      projectId = editingProject.value.id;
    } else {
      projectId = await createProject(projectData);
      setLastCreatedProject(projectId);
    }
    
    toast.add({
      severity: 'success',
      summary: isExisting ? 'Project updated' : 'Project created',
      detail: `Project "${editingProject.value.name}" has been ${isExisting ? 'updated' : 'created'}`,
      life: 3000
    });
    
    router.push(isExisting ? '/projects' : `/projects/${projectId}`);
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

async function addToProject(overlayId: string) {
  if (!projectId.value) return;

  await addOverlayToProjectWithId(projectId.value, overlayId);
  refreshProjectOverlays();
  showAddOverlayDialog.value = false;
}

async function removeFromProject(overlayId: string) {
  if (!projectId.value) return;

  await removeOverlayFromProjectWithId(projectId.value, overlayId);
  refreshProjectOverlays();
}

async function viewOverlay(overlayId: string) {
  if (!projectId.value) return;
  
  const overlay = overlays.value[overlayId];
  if (!overlay) return;
  
  // AI: Navigate to map and focus on overlay
  router.push('/');
  setTimeout(() => {
    if (navigateToOverlay(overlayId)) {
      toast.add({
        severity: 'info',
        summary: 'Viewing Overlay',
        detail: `Navigated to ${overlay.phase || 'Unnamed Overlay'}`,
        life: 3000
      });
    }
  }, 100);
}

// AI: Helper function to refresh project overlays
async function refreshProjectOverlays() {
  if (projectId.value) {
    fullProjectOverlays.value = await getOverlaysForProject(projectId.value);
  }
}

function toggleHighlight() {
  if (!projectId.value) return;

  isHighlighted.value = !isHighlighted.value;
  const action = isHighlighted.value ? highlightProjectOverlays : clearProjectHighlight;
  action(projectId.value);
}

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
}

// AI : Navigation methods
function goBackToProjects() {
  goBack();
}

function viewAllOverlays() {
  if (projectId.value) {
    router.push(`/projects/${projectId.value}/overlays`);
  }
}

function editFromView() {
  if (projectId.value) {
    router.push(`/projects/${projectId.value}/edit`);
  }
}

</script>

<style scoped>
@import "tailwindcss";

/* AI : Styles for the project editor mode */
.project-editor {
  max-width: 800px;
  margin: 0 auto;
}

/* AI : Styles for the project view mode */
.project-view {
  max-width: 800px;
  margin: 0 auto;
}
</style>