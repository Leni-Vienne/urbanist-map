<template>
  <div class="project-picker">
    <!-- AI : Show message when no projects exist -->
    <div v-if="projectList.length === 0 && !hideCreate" class="text-center p-4">
      <p class="mb-4">{{ $t('projectPicker.noProjectsAvailable') }}</p>
      <Button
        icon="pi pi-plus"
        :label="$t('project.create')"
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
            :placeholder="placeholder ?? $t('projectPicker.selectProject')"
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
                    <span class="text-sm opacity-75">({{ $t('projectPicker.overlaysCount', { count: getOverlayCountForProject(option.id) }) }})</span>
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
                  :label="$t('project.create')"
                  class="p-button-primary p-button-sm w-full"
                  @click="openNewProjectDialog"
                  v-tooltip.top="$t('projectPicker.createNewProject')"
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
            v-tooltip.top="$t('common.confirm')"
          />
        </slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';

import { useProjects } from '@composables/project/useProjects';
import { useCityProjects } from '@composables/project/useCityProjects';
import { lastCreatedProjectId, setFileUploadFlow } from '@composables/ui/useProjectState';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { useUiStore } from '@stores/uiStore';
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

// AI : Use UI store to open project dialog
const uiStore = useUiStore();


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

// AI : Compute the project list based on the mode, excluding development projects
const projectList = computed(() => {
  if (props.useCityProjects) {
    // AI : Use city projects data extracted from overlay data, exclude development projects
    return cityProjectsData.value.filter(project => !project.isDevelopment);
  } else {
    // AI : Use local projects from store, exclude development projects
    return Object.values(projects.value).filter(project => !project.isDevelopment);
  }
});

// AI : Update loading state
const isLoadingProjects = computed(() => loading.value);

// AI : Function to auto-select a project by ID
function autoSelectProject(projectId: string) {
  const projectExists = projectList.value.some(p => p.id === projectId);
  
  if (projectExists) {
    selectedProjectId.value = projectId;
    emit('update:modelValue', projectId);
    emit('project-selected', projectId);
    return true;
  }
  
  return false;
}

// AI : Track if we've already auto-selected in this component instance
const hasAutoSelected = ref(false);

// AI : Watch for newly created projects and auto-select them
const stopWatchingForAutoSelect = watch(
  [projectList, () => lastCreatedProjectId.value],
  ([newList, pendingId]) => {
    // AI : Only auto-select if we haven't done it yet AND the project isn't already selected
    if (pendingId && newList.length > 0 && !hasAutoSelected.value && selectedProjectId.value !== pendingId) {
      const project = newList.find(p => p.id === pendingId);
      if (project && autoSelectProject(pendingId)) {
        hasAutoSelected.value = true;
      }
    } else if (selectedProjectId.value === pendingId) {
      hasAutoSelected.value = true;
    }
  },
  { immediate: true }
);

// AI : Initialize selectedProjectId from modelValue prop
watch(() => props.modelValue, (newValue) => {
  if (newValue !== selectedProjectId.value) {
    selectedProjectId.value = newValue;
  }
}, { immediate: true });

// AI : Watch for changes to the selectedProjectId and emit them
watch(selectedProjectId, (newValue, oldValue) => {
  emit('update:modelValue', newValue);
  
  // AI : Also emit project-selected when manually changing selection (not just on initial mount)
  if (newValue && newValue !== oldValue) {
    emit('project-selected', newValue);
  }
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
    // AI : Use UI store to trigger dialog opening
    uiStore.openProjectDialog();
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

// AI : Cleanup watcher on unmount
onUnmounted(() => {
  stopWatchingForAutoSelect();
});
</script>

<style scoped>
.project-picker {
  width: 100%;
}
</style>