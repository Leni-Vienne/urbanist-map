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

  /**
   * AI : Set the selected project ID
   * @param projectId - The ID of the project to select
   */
  function setSelectedProject(projectId: string | null) {
    projectStore.selectedProjectId = projectId;
  }

  /**
   * AI : Clear the selected project
   */
  function clearSelectedProject() {
    projectStore.selectedProjectId = null;
  }

  /**
   * AI : Get the currently selected project object
   */
  const selectedProject = computed(() => {
    if (!projectStore.selectedProjectId) return null;
    return projectStore.projects[projectStore.selectedProjectId] ?? null;
  });

  return {
    selectedProjectId,
    selectedProject,
    setSelectedProject,
    clearSelectedProject
  };
}
