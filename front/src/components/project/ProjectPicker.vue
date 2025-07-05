<template>
  <div class="project-picker">
    <!-- AI : Show message when no projects exist -->
    <div v-if="projectList.length === 0 && !hideCreate" class="text-center p-4">
      <p class="mb-4">No projects available. Create your first project to add overlays.</p>
      <Button
        icon="pi pi-plus"
        label="Create New Project"
        class="p-button-primary"
        @click="openNewProjectDialog"
      />
    </div>

    <!-- AI : Project selector when projects exist -->
    <div
      v-else-if="!hideSelector && projectList.length > 0"
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
            @focus="onSelectFocus"
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

            <template
              #footer
              v-if="!hideCreate"
            >
              <div class="p-2 border-t">
                <Button
                  icon="pi pi-plus"
                  label="Create New Project"
                  class="p-button-primary p-button-sm w-full"
                  @click="openNewProjectDialog"
                  v-tooltip.top="'Create a new project'"
                />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

import { projects } from '@composables/project/useProjects';
import { lastCreatedProjectId } from '@composables/ui/useRouterNavigation';
import { useProjectManagerDialog } from '@composables/project/useProjectManagerDialog';
import type { Project } from '@types';

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

const emit = defineEmits(['update:modelValue', 'project-selected', 'project-created', 'select-focus']);

const loading = ref(false);
const selectedProjectId = ref(props.modelValue);
const hasSelectError = ref(false);

// AI : Watch for changes in the lastCreatedProjectId to auto-select newly created projects
watch(() => lastCreatedProjectId.value, (newProjectId) => {
  if (newProjectId && newProjectId !== selectedProjectId.value) {
    selectedProjectId.value = newProjectId;
    emit('update:modelValue', newProjectId);
    emit('project-selected', newProjectId);
  }
});

watch(() => projects.value, (newProjects) => {
}, { immediate: true });

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

// AI : Handle select focus/click to emit event for lazy loading
function onSelectFocus() {
  emit('select-focus');
}
</script>

<style scoped>

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