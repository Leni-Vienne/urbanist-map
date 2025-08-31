import { computed } from 'vue';
import { useProjectStore } from '@stores/pinia/projectStore';

/**
 * AI : Composable for managing the globally selected project ID
 * This provides a centralized way to access and modify the selected project
 * across all components, preventing state inconsistencies.
 */
export function useSelectedProject() {
  const projectStore = useProjectStore();

  const selectedProjectId = computed({
    get: () => projectStore.selectedProjectId,
    set: (value: string | null) => {
      projectStore.selectedProjectId = value;
    }
  });

  return {
    selectedProjectId,
  };
}
