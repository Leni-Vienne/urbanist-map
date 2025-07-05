<template>
  <!-- AI : Route to appropriate component based on mode -->
  <ProjectForm
    v-if="isFormMode"
    :project="editingProject"
    :mode="formMode"
    @submit="saveProject"
    @cancel="goBack"
  />

  <ProjectViewer
    v-else-if="isViewMode && currentProject"
    :project="currentProject"
    :projectId="projectId"
  />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useProjectEditor } from '@composables/project/useProjectEditor';
import { useProjectHighlight } from '@composables/project/useProjectHighlight';
import { goBack } from '@composables/ui/useRouterNavigation';
import ProjectForm from '@components/project/ProjectForm.vue';
import ProjectViewer from '@components/project/ProjectViewer.vue';

const props = defineProps<{
  id?: string;
  mode: 'edit' | 'view' | 'create';
}>();

// AI : Component state
const mode = computed(() => props.mode);
const projectId = computed(() => props.id || '');

// AI : Use project editor composable for business logic
const {
  editingProject,
  currentProject,
  initializeProject,
  saveProject
} = useProjectEditor(projectId.value, mode.value);

// AI : Use highlight composable for view mode
const { clearHighlightOnModeChange } = useProjectHighlight(projectId.value);

// AI : Computed properties for template
const isFormMode = computed(() => mode.value === 'edit' || mode.value === 'create');
const isViewMode = computed(() => mode.value === 'view');

// AI : Computed property for form mode to ensure type safety
const formMode = computed(() => mode.value as 'edit' | 'create');

// AI : Watch for mode and project changes
watch([projectId, mode], async () => {
  await initializeProject();
}, { immediate: true });

// AI : Clean up highlight when mode changes
watch(mode, clearHighlightOnModeChange);

</script>