import { ref, onBeforeUnmount } from 'vue';
import { highlightProjectOverlays, clearProjectHighlight } from '@composables/project/useProjects';

// AI : Composable for managing project overlay highlighting
export function useProjectHighlight(projectId: string) {
  const isHighlighted = ref(false);

  // AI : Toggle highlight state for project overlays
  const toggleHighlight = () => {
    if (!projectId) return;

    isHighlighted.value = !isHighlighted.value;
    const action = isHighlighted.value ? highlightProjectOverlays : clearProjectHighlight;
    action(projectId);
  };

  // AI : Clear highlights when component unmounts
  const clearHighlightOnUnmount = () => {
    if (isHighlighted.value && projectId) {
      clearProjectHighlight(projectId);
      isHighlighted.value = false;
    }
  };

  // AI : Clear highlights when switching modes
  const clearHighlightOnModeChange = (newMode: string) => {
    if (newMode !== 'view' && projectId && isHighlighted.value) {
      clearProjectHighlight(projectId);
      isHighlighted.value = false;
    }
  };

  onBeforeUnmount(clearHighlightOnUnmount);

  return {
    isHighlighted,
    toggleHighlight,
    clearHighlightOnModeChange
  };
}
