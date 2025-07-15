import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Project, Country } from '@types';

export const useProjectStore = defineStore('project', () => {
  // AI : Central store for project data to avoid circular dependencies
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  /**
   * AI : Add an overlay to a project by ID
   * @param projectId - The ID of the project
   * @param overlayId - The ID of the overlay to add
   */
  async function addOverlayToProjectWithId(projectId: string, overlayId: string): Promise<void> {
    const project = projects.value[projectId];
    if (project) {
      if (!project.overlayIds.includes(overlayId)) {
        project.overlayIds.push(overlayId);
        // AI : Local storage removed - changes are now stored only in memory during edit mode
      }
    }
  }

  /**
   * AI : Remove an overlay from a project by ID
   * @param projectId - The ID of the project
   * @param overlayId - The ID of the overlay to remove
   */
  async function removeOverlayFromProjectWithId(projectId: string, overlayId: string): Promise<void> {
    const project = projects.value[projectId];
    if (project) {
      project.overlayIds = project.overlayIds.filter(id => id !== overlayId);
      // AI : Local storage removed - changes are now stored only in memory during edit mode
    }
  }

  return {
    // State
    projects,
    selectedProjectId,
    countries,
    
    // Actions
    addOverlayToProjectWithId,
    removeOverlayFromProjectWithId
  };
});
