<template>
  <div class="info-popup">
    <div
      v-if="loading"
      class="loading-spinner"
    >
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div
      v-else
      class="project-details"
    >
      <!-- Project Selection Section - Only visible in edit mode -->
      <div 
        v-if="!props.viewMode"
        class="project-selection mb-4"
      >
        <h3 class="text-lg font-bold mb-2">Project Assignment</h3>
        <div class="flex flex-col gap-2">
          <ProjectPicker
            v-model="selectedProjectId"
            @project-selected="applyProjectChange"
            :hideSelector="false"
            :placeholder="project ? 'Change project' : 'Select a project'"
          />
        </div>
      </div>

      <!-- Project Information Section -->
      <div
        v-if="project"
        class="project-meta mb-4"
      >
        <h3 class="text-lg font-bold mb-2">Project Information</h3>
        <div class="info-content p-3 rounded-md bg-gray-50">
          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">Location:</span>
            <span>{{ project.location || 'Not specified' }}</span>
          </div>

          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">Time Period:</span>
            <span v-if="!project.startDate && !project.endDate">Not specified</span>
            <span v-else>
              {{ formatDate(project.startDate) }} - {{ project.endDate ? formatDate(project.endDate) : 'Present' }}
            </span>
          </div>

          <div v-if="project.sourceUrl" class="flex items-center mb-2">
            <span class="font-semibold mr-2">Source:</span>
            <a :href="project.sourceUrl" target="_blank" class="text-blue-600 hover:underline">{{ project.sourceUrl }}</a>
          </div>

          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">Budget:</span>
            <span>{{ project.budget ? formatCurrency(project.budget) : 'Not specified' }}</span>
          </div>

          <div v-if="!props.viewMode" class="mt-3">
            <Button
              label="Edit Project"
              icon="pi pi-pencil"
              class="p-button-sm p-button-outlined p-button-info w-full"
              @click="openProjectManagerForEdit"
            />
          </div>
        </div>
      </div>

      <!-- Image Information Section -->
      <div class="image-meta">
        <h3 class="text-lg font-bold mb-2">Overlay Information</h3>
        <div class="info-content p-3 rounded-md bg-gray-50">
          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">ID:</span>
            <span class="font-mono text-sm">{{ props.overlayObject.id }}</span>
          </div>
          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">Phase:</span>
            <span>{{ props.overlayObject.phase || 'Not specified' }}</span>
          </div>
          <div class="flex items-center mb-2">
            <span class="font-semibold mr-2">Sequence:</span>
            <span>{{ props.overlayObject.sequenceNumber || 'Not specified' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from '../composables/useToast';
import { updateTooltipText } from '../composables/useOverlayActions';
import { projects, addOverlayToProjectWithId, removeOverlayFromProjectWithId } from '../composables/useProjects';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
import ProjectPicker from './ProjectPicker.vue';
import type { OverlayObject, Project } from '../types';

const props = defineProps<{
  overlayObject: OverlayObject;
  onProjectSubmit?: (data: any) => void;
  viewMode?: boolean;
}>();

const toast = useToast();
const { openProjectManager } = useProjectManagerDialog();
const loading = ref(true);
const project = ref<Project | null>(null);
const editingProject = ref(false);
const selectedProjectId = ref<string | undefined>(props.overlayObject.projectId);

// AI : Format date for display
function formatDate(date: Date | null): string {
  if (!date) return 'Not specified';
  return new Date(date).toLocaleDateString();
}

// AI : Format currency for display
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

// AI : Start editing project assignment
function startEditingProject() {
  selectedProjectId.value = props.overlayObject.projectId || undefined;
  editingProject.value = true;
}

// AI : Apply project change to overlay
async function applyProjectChange(projectId: string) {
  try {
    const originalProjectId = props.overlayObject.projectId;

    // AI : If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await removeOverlayFromProjectWithId(originalProjectId, props.overlayObject.id);
    }

    // AI : Add to the new project
    await addOverlayToProjectWithId(projectId, props.overlayObject.id);

    // AI : Update local state
    props.overlayObject.projectId = projectId;

    // AI : Refresh project data
    await loadProjectData();

    toast.add({
      severity: 'success',
      summary: 'Project Updated',
      detail: 'Overlay assigned to project successfully',
      life: 3000
    });

    // AI : Close editing mode
    editingProject.value = false;

    // AI : Update the tooltip text
    updateTooltipText();
  } catch (error) {
    console.error('Error changing project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to assign overlay to project',
      life: 3000
    });
  }
}

// AI : Open project manager for edit
function openProjectManagerForEdit() {
  if (!project.value) return;
  
  // AI : Then open the project manager dialog
  openProjectManager('edit', project.value.id, project.value.name);
}

// AI : Helper function to close the info popup
function closeInfoPopup() {
  // AI : Try multiple ways to close the popup
  const infoLink = document.querySelector('.leaflet-toolbar-0 .pi-info-circle');
  if (infoLink && infoLink instanceof HTMLElement) {
    infoLink.click();
    return;
  }
  
  // AI : Fallback to other selectors
  const infoButtons = document.querySelectorAll('.pi-info-circle');
  for (const button of infoButtons) {
    if (button instanceof HTMLElement) {
      button.click();
      return;
    }
  }
}

// AI : Load current project data
async function loadProjectData() {
  try {
    if (props.overlayObject.projectId) {
      project.value = projects.value[props.overlayObject.projectId] || null;
    } else {
      project.value = null;
    }
  } catch (error) {
    console.error('Error loading project data:', error);
    project.value = null;
  }
}

// AI : Initialize component
onMounted(async () => {
  try {
    // AI : Load current project data
    await loadProjectData();
  } catch (error) {
    console.error('Error initializing InfoPopup:', error);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>

.info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: white;
  user-select: text;
  border-radius: 8px;
  /* so that the popup sits above the toolbar, no matter its height*/
  translate: 0px calc(-100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.info-content {
  border: 1px solid #e5e7eb;
}

.project-selection :deep(.p-inputtext) {
  font-size: 0.875rem;
}

.project-selection :deep(.p-button) {
  font-size: 0.875rem;
}
</style>