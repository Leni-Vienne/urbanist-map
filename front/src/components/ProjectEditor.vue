<template>
  <ProjectForm
    v-if="mode === 'edit' || mode === 'create'"
    :project="editingProject"
    :mode="mode"
    @submit="saveProject"
    @cancel="goBack"
  />
  <!-- Project View Mode -->
  <div
    v-if="mode === 'view' && currentProject"
    class="project-view"
  >
    <div class="project-header mb-3">
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
    <div class="mb-3">
      <div class="flex justify-between items-center mb-2">
        <h5 class="font-bold text-sm">Project Overlays</h5>
        <span class="text-xs bg-gray-200 px-2 py-1 rounded-full">
          {{ currentProject.overlayIds.length }} overlays
        </span>
      </div>

      <div
        v-if="currentProject.overlayIds.length === 0"
        class="text-center p-2 bg-gray-100 rounded-md text-sm"
      >
        No overlays in this project yet
      </div>
      <ProjectOverlaysList
        v-else
        :overlays="projectOverlays"
        @view="viewOverlay"
        @remove="removeFromProject"
      />
    </div>

    <div class="mb-3">
      <h5 class="font-bold mb-2 text-sm">Actions</h5>
      <div class="grid grid-cols-2 gap-2">
        <Button
          label="Add Overlay"
          icon="pi pi-plus"
          class="p-button-outlined p-button-sm"
          @click="showAddOverlayDialog = true"
        />
        <Button
          label="Highlight All"
          icon="pi pi-eye"
          class="p-button-outlined p-button-sm"
          @click="toggleHighlight"
        />
        <Button
          label="Edit Project"
          icon="pi pi-pencil"
          class="p-button-outlined p-button-info p-button-sm col-span-2"
          @click="editFromView()"
        />
      </div>
    </div>

    <Button
      label="Back to Projects"
      icon="pi pi-arrow-left"
      class="p-button-text p-button-sm w-full"
      @click="goBackToProjects"
    />
  </div>
  <!-- Dialog for adding overlays to project -->
  <Dialog
    v-model:visible="showAddOverlayDialog"
    header="Add Overlay to Project"
    :modal="true"
    :closable="true"
    :style="{ width: '400px', maxWidth: '90vw' }"
    @hide="() => { showAddOverlayDialog = false; }"
  >
    <div class="available-overlays">
      <h5 class="font-bold mb-2 text-sm">Available Overlays</h5>
      <div
        v-if="availableOverlays.length === 0"
        class="text-center p-2 bg-gray-100 rounded-md text-sm"
      >
        No available overlays to add
      </div>
      <div
        v-else
        class="flex flex-col gap-1 max-h-48 overflow-y-auto"
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
        class="p-button-text p-button-sm"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue';
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
} from '../composables/useProjects';
import { overlays, initializeOverlays } from '../composables/useOverlay';
import { navigateToOverlay } from '../composables/useOverlayActions';
import { useToast } from '../composables/useToast';
import { initialProjectName, setLastCreatedProject, goBack } from '../composables/useRouterNavigation';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
import type { Project, OverlayObject, OverlayListItem } from '@types';
import ProjectOverlaysList from './ProjectOverlaysList.vue';
import ProjectForm from './ProjectForm.vue';

const props = defineProps<{
  id?: string;
  mode: 'edit' | 'view' | 'create';
}>();

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { inFileUploadFlow } = useProjectManagerDialog();

// AI : Inject database initialization status
const databaseInitialized = inject('databaseInitialized', ref(false));

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
  // AI : First, try to use fullProjectOverlays if available
  if (fullProjectOverlays.value.length > 0) {
    return fullProjectOverlays.value.map(overlay => ({
      id: overlay.id,
      phase: overlay.phase,
      sequenceNumber: overlay.sequenceNumber
    }));
  }
  
  // AI : Fallback: use currentProject overlayIds and overlays store
  if (currentProject.value && currentProject.value.overlayIds.length > 0) {
    const overlayList: OverlayListItem[] = [];
    for (const overlayId of currentProject.value.overlayIds) {
      const overlay = overlays.value[overlayId];
      if (overlay) {
        overlayList.push({
          id: overlay.id,
          phase: overlay.phase,
          sequenceNumber: overlay.sequenceNumber
        });
      }
    }
    return overlayList;
  }
  
  return [];
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
async function saveProject(projectData: Partial<Project>) {
  if (!projectData.name) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'Project name is required',
      life: 3000
    });
    return;
  }

  try {
    const isExisting = !!projectData.id;
    const dataToSave = {
      name: projectData.name,
      description: projectData.description || '',
      location: projectData.location || '',
      startDate: projectData.startDate ?? null,
      endDate: projectData.endDate ?? null,
      sourceUrl: projectData.sourceUrl || '',
      // AI : Add timestamps for database requirements
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let projectId;
    if (isExisting) {
      await updateProject(projectData.id!, dataToSave);
      projectId = projectData.id;
    } else {
      projectId = await createProject(dataToSave);
      setLastCreatedProject(projectId);
    }

    toast.add({
      severity: 'success',
      summary: isExisting ? 'Project updated' : 'Project created',
      detail: `Project "${projectData.name}" has been ${isExisting ? 'updated' : 'created'}`,
      life: 3000
    });

    // AI: Check if creating during file upload flow and return to picker
    if (!isExisting && inFileUploadFlow.value) {
      router.back();
    } else {
      router.push(isExisting ? '/projects' : `/projects/${projectId}`);
    }
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

// AI : Initialize overlays on component mount to ensure data is available
onMounted(async () => {
  if (!databaseInitialized.value) {
    // AI : Wait for database initialization
    const unwatch = watch(databaseInitialized, async (initialized) => {
      if (initialized) {
        unwatch();
        try {
          await initializeOverlays();
          await refreshProjectOverlays();
          console.log('ProjectEditor - overlays initialized:', Object.keys(overlays.value).length);
        } catch (error) {
          console.error('ProjectEditor - error initializing overlays:', error);
        }
      }
    });
  } else {
    // AI : Database already initialized
    try {
      await initializeOverlays();
      await refreshProjectOverlays();
      console.log('ProjectEditor - overlays initialized:', Object.keys(overlays.value).length);
    } catch (error) {
      console.error('ProjectEditor - error initializing overlays:', error);
    }
  }
});

// AI : Navigation methods
function goBackToProjects() {
  goBack();
}

function editFromView() {
  if (projectId.value) {
    router.push(`/projects/${projectId.value}/edit`);
  }
}

</script>

<style scoped>
@import "tailwindcss";

/* AI : Styles for the project view mode */
.project-view {
  max-width: 800px;
  margin: 0 auto;
}
</style>