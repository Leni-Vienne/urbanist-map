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
import { ref, computed } from 'vue';
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
const { openProjectManager } = useProjectManagerDialog();
const loading = ref(false);
const selectedProjectId = ref(props.modelValue);

const projectList = computed(() => Object.values(projects.value));

function getProjectById(id: string): Project | undefined {
  return projectList.value.find(project => project.id === id);
}

function confirmSelection() {
  if (selectedProjectId.value) {
    emit('project-selected', selectedProjectId.value);
  }
}

function openNewProjectDialog() {
  // AI : Open project manager dialog in create mode
  openProjectManager('create');
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