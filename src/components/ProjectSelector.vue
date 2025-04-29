<template>
  <div class="project-selector">
    <div v-if="projectList.length > 0">
      <div class="flex gap-2">
        <FloatLabel class="w-full md:w-56">
          <label for="projectSelect">Project</label>
          <Select
            v-model="selectedProjectId"
            inputId="projectSelect"
            :options="projectList"
            optionLabel="name"
            optionValue="id"
            placeholder="Select a project"
            class="w-full"
            :filter="true"
            :showClear="true"
            :loading="loading"
            aria-labelledby="project-selector-label"
          >
            <template #value="{ value, placeholder }">
              <div
                v-if="value"
                class="flex items-center"
              >
                <div
                  class="color-circle mr-2"
                  :style="{ backgroundColor: getProjectById(value)?.color || '#ccc' }"
                ></div>
                <div>&nbsp;&nbsp;{{ getProjectById(value)?.name }}</div>
              </div>
              <span v-else>{{ placeholder }}</span>
            </template>

            <template #option="{ option }">
              <div class="flex items-center">
                <div
                  class="color-circle mr-2"
                  :style="{ backgroundColor: option.color }"
                ></div>
                <div>
                  <span>&nbsp;&nbsp;{{ option.name }}</span>
                  <span class="text-sm text-gray-500 ml-2">({{ option.overlayIds.length }} overlays)</span>
                </div>
              </div>
            </template>

            <template #footer>
              <div
                v-if="projectList.length > 10"
                class="py-2 px-3 text-xs text-gray-500 border-t"
              >
                {{ projectList.length }} projects available
              </div>
            </template>
          </Select>
        </FloatLabel>
        &nbsp;
        <Button
          icon="pi pi-check"
          class="p-button-primary"
          @click="confirmProjectSelection"
          :disabled="!selectedProjectId"
          v-tooltip.top="'Confirm selection'"
        />
      </div>
    </div>
    <Divider align="center">
      <b>Or create a new project</b>
    </Divider>
    <div class="create-new-project">
      <form @submit.prevent="createAndSelectProject">
        <div class="flex gap-2">
          <FloatLabel class="w-full">
            <InputText
              v-model="newProject.name"
              required
              class="w-full"
            />
            <label>Project Name</label>
          </FloatLabel>
          &nbsp;
          <Button
            type="submit"
            icon="pi pi-plus"
            class="p-button-primary"
            :disabled="newProject.name.length === 0"
            v-tooltip.top="'Create project'"
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

// Import PrimeVue components
import Select from 'primevue/select';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import FloatLabel from 'primevue/floatlabel';

const toast = useToast();

// Define emit events
const emit = defineEmits(['project-selected', 'cancel']);

// Component state
const selectedProjectId = ref('');
const loading = ref(false);
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
function confirmProjectSelection() {
  if (selectedProjectId.value) {
    emit('project-selected', selectedProjectId.value);
  }
}

// Remove the @change handler from the select component and replace with the confirm button
function selectProject(projectId: string) {
  if (projectId) {
    emit('project-selected', projectId);
  }
}

function getProjectById(id: string): Project | undefined {
  return projectList.value.find(project => project.id === id);
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
    loading.value = true;
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
  } finally {
    loading.value = false;
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
}

.color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

/* Add custom styling for the Select component */
:deep(.p-select-panel) {
  max-width: 400px;
}

:deep(.p-select-items-wrapper) {
  max-height: 250px;
}
</style>