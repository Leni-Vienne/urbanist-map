import { computed } from 'vue';
import { useMapStore } from '@stores/pinia/mapStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import type { Project } from '@types';
import { createProject } from '../../utils/typeFactories';

/**
 * AI : Composable to extract unique projects from city overlays data
 * This avoids the need for additional API calls to getProjectsNearLocation
 * since getCityOverlaysAndProjects already includes all project data we need
 */

// AI : Extract unique projects from the current city overlays data
export function useCityProjects() {
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  const projects = computed(() => {
    const projectMap = new Map<string, Project>();

    // AI : Extract projects from overlay data (backend projects)
    mapStore.currentCityOverlays.forEach(overlay => {
      if (overlay.project?.id) {
        const project = overlay.project;

        // AI : Use factory function for consistent project creation
        const frontendProject = createProject({
          ...project,
          description: project.description ?? null,
          overlayIds: [], // AI : We'll count overlays differently
          savedRemotely: true
        });

        projectMap.set(project.id, frontendProject);
      }
    });

    // AI : Also include local projects that might not be in currentCityOverlays yet
    // AI : (e.g., newly created projects not yet saved to backend)
    Object.values(projectStore.projects).forEach(project => {
      // AI : Only add if not already in map (backend projects take precedence)
      if (!projectMap.has(project.id)) {
        projectMap.set(project.id, project);
      }
    });

    return Array.from(projectMap.values());
  });
  
  // AI : Projects with overlay counts attached
  const projectsWithCounts = computed(() => {
    return projects.value.map(project => ({
      ...project,
      overlayCount: getOverlayCountForProject(project.id)
    }));
  });

  // AI : Function to get overlay count for a specific project
  function getOverlayCountForProject(projectId: string): number {
    return mapStore.currentCityOverlays.filter(overlay =>
      overlay.project?.id === projectId
    ).length;
  }

  return {
    projects,
    projectsWithCounts,
    getOverlayCountForProject
  };
}