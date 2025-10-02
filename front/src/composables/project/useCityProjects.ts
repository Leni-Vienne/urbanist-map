import { computed } from 'vue';
import { currentCityOverlays } from '@composables/map/useCityOverlays';
import type { Project } from '@types';
import { createProject } from '../../utils/typeFactories';

/**
 * AI : Composable to extract unique projects from city overlays data
 * This avoids the need for additional API calls to getProjectsNearLocation
 * since getCityProjects already includes all project data we need
 */

// AI : Extract unique projects from the current city overlays data
export function useCityProjects() {
  const projects = computed(() => {
    const projectMap = new Map<string, Project>();
    
    // AI : Extract projects from overlay data
    currentCityOverlays.value.forEach(overlay => {
      if (overlay.project && overlay.project.id) {
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
    
    return Array.from(projectMap.values());
  });
  
  // AI : Function to get overlay count for a specific project
  function getOverlayCountForProject(projectId: string): number {
    return currentCityOverlays.value.filter(overlay =>
      overlay.project && overlay.project.id === projectId
    ).length;
  }
  
  // AI : Projects with overlay counts attached
  const projectsWithCounts = computed(() => {
    return projects.value.map(project => ({
      ...project,
      overlayCount: getOverlayCountForProject(project.id)
    }));
  });
  
  return {
    projects,
    projectsWithCounts,
    getOverlayCountForProject
  };
}