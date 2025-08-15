import { ref } from 'vue';
import type { Project } from '@types';

// AI : Global state for project dialog communication
const showProjectDialogGlobally = ref(false);
const projectDialogData = ref<Partial<Project>>({});
const projectDialogMode = ref<'create' | 'edit'>('create');

export function useProjectDialogState() {
  function openProjectDialog(project?: Partial<Project>, mode: 'create' | 'edit' = 'create') {
    projectDialogData.value = project ?? {};
    projectDialogMode.value = mode;
    showProjectDialogGlobally.value = true;
  }
  
  function closeProjectDialog() {
    showProjectDialogGlobally.value = false;
    projectDialogData.value = {};
    projectDialogMode.value = 'create';
  }
  
  return {
    showProjectDialogGlobally,
    projectDialogData,
    projectDialogMode,
    openProjectDialog,
    closeProjectDialog
  };
}