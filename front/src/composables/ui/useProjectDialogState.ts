import { ref } from 'vue';

// AI : Global state for project dialog communication
const showProjectDialogGlobally = ref(false);

export function useProjectDialogState() {
  function openProjectDialog() {
    console.log('AI: Opening project dialog globally');
    showProjectDialogGlobally.value = true;
  }
  
  function closeProjectDialog() {
    showProjectDialogGlobally.value = false;
  }
  
  return {
    showProjectDialogGlobally,
    openProjectDialog,
    closeProjectDialog
  };
}