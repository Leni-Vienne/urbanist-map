<template>
  <div class="project-picker">
    <!-- AI : Show error message for nearby projects -->
    <div v-if="props.useNearbyProjects && nearbyError" class="text-center p-4">
      <i class="pi pi-exclamation-triangle text-red-500 text-2xl mb-2"></i>
      <p class="text-red-600 mb-4">{{ nearbyError }}</p>
      <Button
        icon="pi pi-refresh"
        label="Retry"
        class="p-button-secondary"
        @click="onSelectFocus"
      />
    </div>

    <!-- AI : Show loading message for nearby projects -->
    <div v-else-if="props.useNearbyProjects && isLoadingProjects" class="text-center p-4">
      <i class="pi pi-spin pi-spinner text-2xl mb-2"></i>
      <p>Finding nearby projects...</p>
    </div>

    <!-- AI : Show message when no nearby projects are found -->
    <div v-else-if="props.useNearbyProjects && projectList.length === 0 && !isLoadingProjects && !hideCreate" class="text-center p-4">
      <p class="mb-4">No nearby projects found in this area. Create a new project to add your overlay.</p>
      <Button
        icon="pi pi-plus"
        label="Create New Project"
        class="p-button-primary"
        @click="openNewProjectDialog"
      />
    </div>

    <!-- AI : Show message when no projects exist -->
    <div v-else-if="!props.useNearbyProjects && projectList.length === 0 && !hideCreate" class="text-center p-4">
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
            :placeholder="props.useNearbyProjects ? 'Select a nearby project' : (placeholder ?? 'Select a project')"
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
                  <div v-if="props.useNearbyProjects && option.city" class="text-xs opacity-60">
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
import { fetchNearbyProjects, getNearbyProjects } from '@composables/project/useNearbyProjects';
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
  useNearbyProjects: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'project-selected', 'project-created', 'select-focus', 'create-project']);

// AI : Get store refs using the composable pattern
const { projects } = useProjects();

const loading = ref(false);
const hasSelectError = ref(false);

// AI : Use centralized selected project state
const { selectedProjectId } = useSelectedProject();

// AI : Use global project dialog state
const { openProjectDialog } = useProjectDialogState();

// AI : Get nearby projects composable
const { projects: nearbyProjectsData, isLoading: nearbyLoading, error: nearbyError } = getNearbyProjects();

// AI : Function to count overlays for a project using the appropriate data source
function getOverlayCountForProject(projectId: string): number {
  const project = projectList.value.find(p => p.id === projectId);
  if (!project) return 0;
  
  // AI : For nearby projects, use the overlayCount from backend
  if (props.useNearbyProjects && 'overlayCount' in project) {
    return (project as any).overlayCount ?? 0;
  }
  
  // AI : For local projects, check both overlayIds and overlays arrays
  if (project.overlayIds && project.overlayIds.length > 0) {
    return project.overlayIds.length;
  }
  
  // AI : Some projects have overlays stored as full objects in an overlays array (from getCityProjects)
  if ((project as any).overlays && Array.isArray((project as any).overlays)) {
    return (project as any).overlays.length;
  }
  
  return 0;
}

// AI : Compute the project list based on the mode
const projectList = computed(() => {
  if (props.useNearbyProjects) {
    // AI : Convert nearby projects to the expected format
    return nearbyProjectsData.value.map(project => ({
      id: project.id,
      name: project.name,
      description: project.description,
      overlayIds: [], // AI : We don't have overlay IDs in nearby projects response
      overlayCount: project.overlayCount ?? 0, // AI : Use overlay count from backend
      color: '#007bff', // AI : Default color for nearby projects
      cityId: project.cityId,
      status: 'approved' as const, // AI : Only approved projects are returned from nearby endpoint
      ownerId: project.ownerId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      metadata: project.metadata,
      city: project.city ? {
        id: project.city.id,
        name: project.city.name,
        countryCode: project.city.countryCode,
        coordinates: { x: project.city.lng, y: project.city.lat },
        createdAt: null,
        updatedAt: new Date()
      } : undefined,
      sourceUrl: null,
      startDate: null,
      endDate: null,
      latestUpdateOn: null
    }));
  } else {
    return Object.values(projects.value);
  }
});

// AI : Update loading state based on the mode
const isLoadingProjects = computed(() => {
  return props.useNearbyProjects ? nearbyLoading.value : loading.value;
});

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

// AI : Watch for useNearbyProjects prop to fetch nearby projects when dialog opens
watch(() => props.useNearbyProjects, async (useNearby) => {
  if (useNearby) {
    try {
      await fetchNearbyProjects();
    } catch (error) {
      console.error('Error fetching nearby projects on dialog open:', error);
    }
  }
}, { immediate: true });

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