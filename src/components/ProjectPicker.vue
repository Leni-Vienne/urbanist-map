# New file
<template>
  <div class="project-picker">
    <div
      v-if="!hideSelector && projectList.length > 0"
      class="mb-4"
    >
      <div class="flex gap-2">
        <FloatLabel class="w-full">
          <Select
            v-model="selectedProjectId"
            :options="projectList"
            optionLabel="name"
            optionValue="id"
            :placeholder="placeholder || 'Select a project'"
            class="w-full"
            :filter="true"
            :showClear="true"
            :loading="loading"
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
          </Select>
        </FloatLabel>
        <slot name="selector-actions">
          <Button
            icon="pi pi-check"
            class="p-button-primary"
            @click="confirmSelection"
            :disabled="!selectedProjectId"
            v-tooltip.top="'Confirm selection'"
          />
        </slot>
      </div>
    </div>

    <template v-if="!hideCreate">
      <Divider
        align="center"
        v-if="!hideSelector && projectList.length > 0"
      >
        <b>Or create a new project</b>
      </Divider>

      <div class="create-project">
        <form @submit.prevent="handleProjectCreation">
          <div class="flex gap-2">
            <FloatLabel class="w-full">
              <InputText
                v-model="newProject.name"
                required
                class="w-full"
              />
              <label>Project Name</label>
            </FloatLabel>
            <slot name="create-actions">
              <Button
                type="submit"
                icon="pi pi-plus"
                class="p-button-primary"
                :disabled="newProject.name.length === 0"
                v-tooltip.top="'Create project'"
              />
            </slot>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { projects, createProject } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import type { Project } from '../types';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  createPlaceholder: {
    type: String,
    default: ''
  },
  hideSelector: {
    type: Boolean,
    default: false
  },
  hideCreate: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'project-selected', 'project-created']);

const toast = useToast();
const loading = ref(false);
const selectedProjectId = ref(props.modelValue);
const newProject = ref({
  name: '',
  description: '',
  location: '',
  startDate: null as Date | null,
  endDate: null as Date | null,
  budget: 0
});

const projectList = computed(() => Object.values(projects.value));

function getProjectById(id: string): Project | undefined {
  return projectList.value.find(project => project.id === id);
}

function confirmSelection() {
  if (selectedProjectId.value) {
    emit('project-selected', selectedProjectId.value);
  }
}

async function handleProjectCreation() {
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
    const projectId = await createProject({
      name: newProject.value.name,
      description: newProject.value.description,
      location: newProject.value.location,
      startDate: newProject.value.startDate,
      endDate: newProject.value.endDate,
      budget: newProject.value.budget
    });

    emit('project-created', projectId);
    emit('project-selected', projectId);

    toast.add({
      severity: 'success',
      summary: 'Project Created',
      detail: `Project "${newProject.value.name}" has been created`,
      life: 3000
    });

    // Reset form
    newProject.value.name = '';
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
</script>

<style scoped>
@import "tailwindcss";

.project-picker {
  width: 100%;
}

.color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
</style>