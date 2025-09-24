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
            :placeholder="placeholder ?? 'Select a project'"
            class="w-full"
            :filter="true"
            :showClear="true"
            :loading="isLoadingProjects"
            @focus="onSelectFocus"
          >
            <template #value="{ value, placeholder }">
              <div
                v-if="value"
                class="flex items-center gap-2"
              >
                <div
                  class="w-3 h-3 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: getProjectById(value)?.color ?? '#ccc' }"
                ></div>
                <span>{{ getProjectById(value)?.name }}</span>
              </div>
              <span v-else>{{ placeholder }}</span>
            </template>

            <template #option="{ option }">
              <div class="flex items-center gap-2">
                <div
                  class="w-3 h-3 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: option.color }"
                ></div>
                <div>
                  <div class="flex items-center gap-2">
                    <span>{{ option.name }}</span>
                    <span class="text-sm opacity-75">({{ getOverlayCountForProject(option.id) }} overlays)</span>
                  </div>
                  <div v-if="option.city" class="text-xs opacity-60">
                    {{ option.city.name }}, {{ option.city.countryCode }}
                  </div>
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

import { useProjects } from '@composables/project/useProjects';
import { useCityProjects } from '@composables/project/useCityProjects';
import { lastCreatedProjectId, setFileUploadFlow } from '@composables/ui/useProjectState';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { useProjectDialogState } from '@composables/ui/useProjectDialogState';
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
  },
  useCityProjects: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'project-selected', 'project-created', 'select-focus', 'create-project']);

// AI : Get store refs using the composable pattern
const { projects } = useProjects();

const loading = ref(false);

// AI : Use centralized selected project state
const { selectedProjectId } = useSelectedProject();

// AI : Use global project dialog state
const { openProjectDialog } = useProjectDialogState();


// AI : Get city projects composable
const { projectsWithCounts: cityProjectsData, getOverlayCountForProject: getCityOverlayCount } = useCityProjects();

// AI : Function to count overlays for a project using the appropriate data source
function getOverlayCountForProject(projectId: string): number {
  // AI : Use city projects data when available (most efficient)
  if (props.useCityProjects) {
    return getCityOverlayCount(projectId);
  }
  
  // AI : For local projects, check overlayIds array
  const project = projectList.value.find(p => p.id === projectId);
  if (project?.overlayIds && Array.isArray(project.overlayIds)) {
    return project.overlayIds.length;
  }
  
  return 0;
}

// AI : Compute the project list based on the mode, excluding marker projects
const projectList = computed(() => {
  if (props.useCityProjects) {
    // AI : Use city projects data extracted from overlay data, exclude marker projects
    return cityProjectsData.value.filter(project => !project.isMarker);
  } else {
    // AI : Use local projects from store, exclude marker projects
    return Object.values(projects.value).filter(project => !project.isMarker);
  }
});

// AI : Update loading state
const isLoadingProjects = computed(() => loading.value);

// AI : Watch for changes in the lastCreatedProjectId to auto-select newly created projects
watch(() => lastCreatedProjectId.value, (newProjectId) => {
  if (newProjectId && newProjectId !== selectedProjectId.value) {
    selectedProjectId.value = newProjectId;
    emit('update:modelValue', newProjectId);
    emit('project-selected', newProjectId);
  }
});

// AI : Initialize selectedProjectId from modelValue prop
watch(() => props.modelValue, (newValue) => {
  if (newValue !== selectedProjectId.value) {
    selectedProjectId.value = newValue;
  }
}, { immediate: true });

// AI : Watch for changes to the selectedProjectId and emit them
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

function openNewProjectDialog() {
  try {
    // AI : Set flag when creating from ProjectPicker
    setFileUploadFlow(true);
    // AI : Use global state to trigger dialog opening
    openProjectDialog();
    // AI : Also emit event as fallback
    emit('create-project');
  } catch (err) {
    console.error('AI: Failed to open project dialog', err);
  }
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
</style>