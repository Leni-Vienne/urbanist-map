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
        <div class="flex">
          <Button
            icon="pi pi-plus"
            label="New Project"
            class="p-button-primary w-full"
            @click="openNewProjectDialog"
            v-tooltip.top="'Create a new project'"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { projects, createProject } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
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
const { openProjectManager, setFileUploadFlow, lastCreatedProjectId } = useProjectManagerDialog();
const loading = ref(false);
const selectedProjectId = ref(props.modelValue);

// AI : Watch for changes in the lastCreatedProjectId to auto-select newly created projects
watch(() => lastCreatedProjectId.value, (newProjectId) => {
  if (newProjectId) {
    selectedProjectId.value = newProjectId;
    emit('update:modelValue', newProjectId);
    
    // AI : Automatically trigger project selection if we have a new project
    emit('project-selected', newProjectId);
  }
});

const projectList = computed(() => Object.values(projects.value));

// AI : Watch for changes to the modelValue prop
watch(() => props.modelValue, (newValue) => {
  if (newValue !== selectedProjectId.value) {
    selectedProjectId.value = newValue;
  }
});

// AI : Watch for changes to the selectedProjectId ref and emit them
watch(selectedProjectId, (newValue) => {
  emit('update:modelValue', newValue);
});

// AI : Watch for changes in projects to select the most recently created project
// This helps when a new project is created and we want to select it automatically
watch(projectList, (newProjectList, oldProjectList) => {
  // AI : If a new project was added, select it
  if (newProjectList.length > oldProjectList.length) {
    // AI : Find the newly added project (assuming only one was added)
    const newProject = newProjectList.find(project => 
      !oldProjectList.some(oldProject => oldProject.id === project.id)
    );
    
    if (newProject) {
      selectedProjectId.value = newProject.id;
      emit('update:modelValue', newProject.id);
      emit('project-selected', newProject.id);
    }
  }
}, { deep: true });

function getProjectById(id: string): Project | undefined {
  return projectList.value.find(project => project.id === id);
}

function confirmSelection() {
  if (selectedProjectId.value) {
    emit('project-selected', selectedProjectId.value);
  }
}

function openNewProjectDialog() {
  // AI : Open project manager dialog in create mode, indicating that we are coming from the picker
  setFileUploadFlow(true);
  openProjectManager('create', '', '', 'picker');
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