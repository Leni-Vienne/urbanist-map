<template>
  <div class="project-picker">
    <div
      v-if="!hideSelector && projectList.length > 0 && isPrimeVueReady"
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
import { ref, computed, watch, onMounted } from 'vue';

import { projects } from '../composables/useProjects';
import { useToast } from '../composables/useToast';
import { lastCreatedProjectId } from '../composables/useRouterNavigation';
import { useProjectManagerDialog } from '../composables/useProjectManagerDialog';
import type { Project } from '@types';

// AI : Add isPrimeVueReady ref to track PrimeVue initialization
const isPrimeVueReady = ref(false);

// AI : Check if PrimeVue is initialized on component mount
onMounted(() => {
  // Use nextTick to ensure Vue has finished rendering
  window.setTimeout(() => {
    isPrimeVueReady.value = true;
  }, 0);
});

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

const loading = ref(false);
const selectedProjectId = ref(props.modelValue);

// AI : Watch for changes in the lastCreatedProjectId to auto-select newly created projects
watch(() => lastCreatedProjectId.value, (newProjectId) => {
  if (newProjectId && newProjectId !== selectedProjectId.value) {
    selectedProjectId.value = newProjectId;
    emit('update:modelValue', newProjectId);
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

function getProjectById(id: string): Project | undefined {
  return projectList.value.find(project => project.id === id);
}

function confirmSelection() {
  if (selectedProjectId.value) {
    emit('project-selected', selectedProjectId.value);
  }
}

const { setFileUploadFlow } = useProjectManagerDialog();

function openNewProjectDialog() {
  if (!window.router) {
    console.error('Global router not available for navigation');
    return;
  }
  
  // AI : Set flag when creating from ProjectPicker
  setFileUploadFlow(true);
  window.router.push('/projects/create');
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