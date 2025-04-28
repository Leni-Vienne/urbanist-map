// filepath: d:\Documents\Perso\prog\city-map-overlay\src\components\ProjectSelector.vue
<template>
  <div class="project-selector">
    <h3 class="text-xl font-bold mb-4">Select a Project</h3>
    
    <div v-if="projectList.length > 0" class="existing-projects mb-4">
      <p class="mb-2">Choose an existing project:</p>
      <div class="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
        <div 
          v-for="project in projectList" 
          :key="project.id"
          class="project-item flex items-center p-2 border rounded-md cursor-pointer hover:bg-gray-50"
          :style="{
            borderLeft: `6px solid ${project.color}`,
            background: `linear-gradient(to right, ${project.color}10, transparent)`
          }"
          @click="selectProject(project.id)"
        >
          <div class="flex-1">
            <span class="font-bold">{{ project.name }}</span>
            <span class="text-sm text-gray-500 ml-2">({{ project.overlayIds.length }} overlays)</span>
          </div>
          <Button 
            icon="pi pi-check" 
            class="p-button-sm p-button-success" 
            @click.stop="selectProject(project.id)"
          />
        </div>
      </div>
    </div>
    
    <div class="create-new-project">
      <p class="mb-2">Or create a new project:</p>
      <form @submit.prevent="createAndSelectProject" class="flex flex-col gap-3">
        <FloatLabel>
          <InputText v-model="newProject.name" required />
          <label>Project Name</label>
        </FloatLabel>
        
        <FloatLabel>
          <InputText v-model="newProject.location" />
          <label>Location (optional)</label>
        </FloatLabel>
        
        <div class="text-right mt-2">
          <Button 
            type="submit" 
            label="Create Project" 
            icon="pi pi-plus" 
            class="p-button-primary"
          />
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { projects, createProject } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import type { Project } from '../types';

const toast = useToast();

// Define emit events
const emit = defineEmits(['project-selected', 'cancel']);

// Component state
const newProject = ref({
  name: '',
  description: '',
  location: '',
  startDate: null as Date | null,
  endDate: null as Date | null,
  budget: 0
});

// Computed properties
const projectList = computed(() => {
  return Object.values(projects.value);
});

// Methods
function selectProject(projectId: string) {
  emit('project-selected', projectId);
}

async function createAndSelectProject() {
  if (!newProject.value.name) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Please enter a project name',
      life: 3000
    });
    return;
  }
  
  try {
    // Create new project
    const projectId = await createProject({
      name: newProject.value.name,
      description: newProject.value.description,
      location: newProject.value.location,
      startDate: newProject.value.startDate,
      endDate: newProject.value.endDate,
      budget: newProject.value.budget
    });
    
    // Select the newly created project
    selectProject(projectId);
    
    toast.add({
      severity: 'success',
      summary: 'Project Created',
      detail: `Project "${newProject.value.name}" has been created`,
      life: 3000
    });
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

// Initialize
onMounted(() => {
  // If no projects exist, pre-populate with a default name
  if (projectList.value.length === 0) {
    newProject.value.name = 'New Construction Project';
  }
});
</script>

<style scoped>
@import "tailwindcss";
@import "tailwindcss-primeui";

.project-selector {
  padding: 1rem;
  width: 100%;
  max-width: 400px;
  background-color: white;
  border-radius: 8px;
}

.project-item {
  transition: transform 0.2s ease;
}

.project-item:hover {
  transform: translateX(2px);
}
</style>