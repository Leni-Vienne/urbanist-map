<template>
  <div class="info-popup">
    <div v-if="loading" class="loading-spinner">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
    </div>
    <div v-else class="project-details">
      <h3 class="text-xl font-bold mb-4" :style="{ color: project?.color }">{{ project?.name || 'Project Information' }}</h3>
      
      <!-- Project Selection Section -->
      <div class="project-selection mb-4">
        <div class="font-semibold mb-2">Project Assignment:</div>
        <div v-if="!editingProject" class="flex flex-col gap-2">
          <div class="flex justify-between items-center">
            <span v-if="project">
              <span class="mr-2">Assigned to:</span>
              <Tag :style="{ backgroundColor: project.color + '30', color: project.color, borderColor: project.color }">
                {{ project.name }}
              </Tag>
            </span>
            <span v-else class="text-gray-500 italic">No project assigned</span>
            
            <Button 
              icon="pi pi-pencil" 
              class="p-button-sm p-button-text" 
              @click="startEditingProject"
              v-tooltip.top="'Change project'"
            />
          </div>
          <Button 
            v-if="!project"
            label="Assign to Project" 
            icon="pi pi-link" 
            class="p-button-sm p-button-outlined mt-1"
            @click="startEditingProject"
          />
        </div>
        
        <!-- Project Edit Form -->
        <div v-else class="project-edit-form">
          <div class="mb-3">
            <label class="block mb-1 text-sm">Select Existing Project:</label>
            <Select 
              v-model="selectedProjectId" 
              :options="projectsList" 
              optionLabel="name" 
              optionValue="id"
              class="w-full"
              placeholder="Select a project"
            >
              <template #value="slotProps">
                <div v-if="slotProps.value" class="flex align-items-center gap-2">
                  <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: getProjectColor(slotProps.value) }"></span>
                  <div>{{ getProjectName(slotProps.value) }}</div>
                </div>
                <span v-else>Select a project</span>
              </template>
              <template #option="slotProps">
                <div class="flex align-items-center gap-2">
                  <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: slotProps.option.color }"></span>
                  <div>{{ slotProps.option.name }}</div>
                </div>
              </template>
            </Select>
          </div>
          
          <Divider>
            <span class="text-xs text-gray-500">OR</span>
          </Divider>
          
          <div class="mb-3">
            <label class="block mb-1 text-sm">Create New Project:</label>
            <div class="flex gap-2">
              <InputText 
                v-model="newProjectName" 
                placeholder="Enter project name" 
                class="flex-grow"
              />
              <Button 
                icon="pi pi-plus" 
                :disabled="!newProjectName.trim()"
                @click="createNewProject"
                v-tooltip.top="'Create new project'"
              />
            </div>
          </div>
          
          <div class="flex justify-between mt-3">
            <Button 
              label="Cancel" 
              icon="pi pi-times" 
              class="p-button-sm p-button-outlined p-button-secondary"
              @click="cancelEditingProject"
            />
            <Button 
              label="Apply" 
              icon="pi pi-check" 
              class="p-button-sm p-button-success"
              :disabled="!selectedProjectId && !newProjectName.trim()"
              @click="applyProjectChange"
            />
          </div>
        </div>
      </div>
      
      <!-- Project Information Section -->
      <div v-if="project" class="project-meta mb-4">
        <div class="font-semibold mb-2">Project Information:</div>
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
        
        <div class="flex items-center mb-2">
          <span class="font-semibold mr-2">Budget:</span>
          <span>{{ project.budget ? formatCurrency(project.budget) : 'Not specified' }}</span>
        </div>
      </div>
      
      <!-- Actions Section -->
      <div class="actions mt-4 flex justify-between">
        <div></div> <!-- Empty div for spacing -->
        <Button 
          v-if="project"
          label="Manage Project" 
          icon="pi pi-cog" 
          class="p-button-sm p-button-outlined p-button-info"
          @click="openProjectManager"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { saveOverlay } from '../composables/useDatabase';
import { useToast } from '../composables/useToast';
import { updateTooltipText } from '../composables/useOverlayActions';
import { truncateString } from '../utils';
import { 
  projects, 
  createProject, 
  addOverlayToProjectWithId, 
  removeOverlayFromProjectWithId 
} from '../composables/useProjects';
import type { OverlayObject, Project } from '../types';

const props = defineProps<{
  overlayObject: OverlayObject;
  onProjectSubmit?: (data: any) => void;
}>();

const emit = defineEmits(['close', 'open-project-manager']);

const toast = useToast();
const loading = ref(true);
const project = ref<Project | null>(null);
const projectsList = ref<Project[]>([]);

// Project editing state
const editingProject = ref(false);
const selectedProjectId = ref<string | null>(null);
const newProjectName = ref('');

// Format date for display
function formatDate(date: Date | null): string {
  if (!date) return 'Not specified';
  return new Date(date).toLocaleDateString();
}

// Format currency for display
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

// Get project color for dropdown
function getProjectColor(projectId: string): string {
  const foundProject = projectsList.value.find(p => p.id === projectId);
  return foundProject ? foundProject.color : '#ccc';
}

// Get project name for dropdown
function getProjectName(projectId: string): string {
  const foundProject = projectsList.value.find(p => p.id === projectId);
  return foundProject ? foundProject.name : 'Unknown Project';
}

// Start editing project assignment
function startEditingProject() {
  selectedProjectId.value = props.overlayObject.projectId || null;
  newProjectName.value = '';
  editingProject.value = true;
}

// Cancel editing project assignment
function cancelEditingProject() {
  editingProject.value = false;
  selectedProjectId.value = props.overlayObject.projectId || null;
  newProjectName.value = '';
}

// Create a new project
async function createNewProject() {
  if (!newProjectName.value.trim()) return;
  
  try {
    // Set the newly created project as selected
    selectedProjectId.value = await createProject({
      name: newProjectName.value,
      description: '',
      location: '',
      startDate: null,
      endDate: null,
      budget: 0
    });
    
    // Refresh projects list
    await loadProjects();
    
    toast.add({
      severity: 'success',
      summary: 'Project Created',
      detail: `Project "${newProjectName.value}" created successfully`,
      life: 3000
    });
    
    // Clear the new project name field
    newProjectName.value = '';
  } catch (error) {
    console.error('Error creating project:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to create project',
      life: 3000
    });
  }
}

// Apply project change to overlay
async function applyProjectChange() {
  if (!selectedProjectId.value) return;
  
  try {
    const originalProjectId = props.overlayObject.projectId;
    
    // If overlay already belongs to a project, remove it first
    if (originalProjectId) {
      await removeOverlayFromProjectWithId(originalProjectId, props.overlayObject.id);
    }
    
    // Add to the new project
    await addOverlayToProjectWithId(selectedProjectId.value, props.overlayObject.id);
    
    // Update local state
    props.overlayObject.projectId = selectedProjectId.value;
    
    // Refresh project data
    await loadProjectData();
    
    toast.add({
      severity: 'success',
      summary: 'Project Updated',
      detail: 'Overlay assigned to project successfully',
      life: 3000
    });
    
    // Close editing mode
    editingProject.value = false;
    
    // Update the tooltip text
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

// Open project manager
function openProjectManager() {
  emit('open-project-manager', props.overlayObject.projectId);
}

// Load all projects for dropdown
async function loadProjects() {
  try {
    projectsList.value = Object.values(projects.value);
  } catch (error) {
    console.error('Error loading projects list:', error);
  }
}

// Load current project data
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

// Initialize component
onMounted(async () => {
  try {
    // Load all projects for dropdown
    await loadProjects();
    
    // Load current project data
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
  translate: 0px calc(-100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.project-selection, .project-meta {
  background-color: #f8f9fa;
  padding: 0.75rem;
  border-radius: 6px;
}
</style>