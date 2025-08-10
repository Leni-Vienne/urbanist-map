<template>
  <!-- AI : Use ProjectDialog for all modes - ProjectViewer was removed -->
  <ProjectDialog
    v-if="isFormMode"
    :visible="true"
    :project="editingProject"
    :mode="formMode"
    :title="dialogTitle"
    @submit="saveProject"
    @cancel="goBack"
    @update:visible="handleDialogVisibility"
  />

  <div v-else-if="isViewMode && currentProject" class="p-4">
    <!-- AI : Simplified project view since ProjectViewer was removed -->
    <h2 class="text-xl font-bold mb-2">{{ currentProject.name }}</h2>
    <p class="text-gray-600">{{ currentProject.description }}</p>
    <div class="mt-4 text-sm text-gray-500">
      Project ID: {{ projectId }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useProjectEditor, type ProjectEditorOptions } from '@composables/project/useProjectEditor';
import { useProjectHighlight } from '@composables/project/useProjectHighlight';
import { goBack } from '@composables/ui/useRouterNavigation';
import ProjectDialog from '@components/project/ProjectDialog.vue';
// AI : ProjectViewer was removed

const props = defineProps<{
  id?: string;
  mode: 'edit' | 'view' | 'create';
}>();

// AI : Component state
const mode = computed(() => props.mode);
const projectId = computed(() => props.id ?? '');

// AI : Options for project editor callbacks
const editorOptions: ProjectEditorOptions = {
  onProjectSaved: (projectId: string, isNewProject: boolean) => {
    // AI : Navigate back after saving
    goBack();
  },
  onCancel: () => {
    // AI : Navigate back when cancelled
    goBack();
  }
};

// AI : Use project editor composable for business logic
const {
  editingProject,
  currentProject,
  initializeProject,
  saveProject
} = useProjectEditor(projectId.value, mode.value, editorOptions);

// AI : Use highlight composable for view mode
const { clearHighlightOnModeChange } = useProjectHighlight(projectId.value);

// AI : Computed properties for template
const isFormMode = computed(() => mode.value === 'edit' || mode.value === 'create');
const isViewMode = computed(() => mode.value === 'view');

// AI : Computed property for form mode to ensure type safety
const formMode = computed(() => mode.value as 'edit' | 'create');

// AI : Computed dialog title based on mode
const dialogTitle = computed(() => {
  return mode.value === 'create' ? 'Create New Project' : 'Edit Project';
});

// AI : Handle dialog visibility changes
function handleDialogVisibility(visible: boolean) {
  if (!visible) {
    goBack();
  }
}

// AI : Watch for mode and project changes
watch([projectId, mode], async () => {
  await initializeProject();
}, { immediate: true });

// AI : Clean up highlight when mode changes
watch(mode, clearHighlightOnModeChange);

</script>