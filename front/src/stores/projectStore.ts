import { ref } from 'vue';
import type { Project, Country } from '@types';
import { saveProject } from '@composables/core/useDatabase';

// AI : Central store for project data to avoid circular dependencies
export const projects = ref<Record<string, Project>>({});
export const selectedProjectId = ref<string | null>(null);
export const countries = ref<Country[]>([]);

/**
 * AI : Add an overlay to a project by ID
 * @param projectId - The ID of the project
 * @param overlayId - The ID of the overlay to add
 */
export async function addOverlayToProjectWithId(projectId: string, overlayId: string): Promise<void> {
  const project = projects.value[projectId];
  if (project) {
    if (!project.overlayIds.includes(overlayId)) {
      project.overlayIds.push(overlayId);
      // AI : Persist the change to IndexedDB
      await saveProject(project);
    }
  }
}

/**
 * AI : Remove an overlay from a project by ID
 * @param projectId - The ID of the project
 * @param overlayId - The ID of the overlay to remove
 */
export async function removeOverlayFromProjectWithId(projectId: string, overlayId: string): Promise<void> {
  const project = projects.value[projectId];
  if (project) {
    project.overlayIds = project.overlayIds.filter(id => id !== overlayId);
    // AI : Persist the change to IndexedDB
    await saveProject(project);
  }
}
