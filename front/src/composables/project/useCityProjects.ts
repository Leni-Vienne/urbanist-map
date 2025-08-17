import { computed } from 'vue';
import { currentCityOverlays } from '@composables/map/useCityMarkers';
import type { Project } from '@types';

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
        
        // AI : Convert backend project format to frontend Project type
        const frontendProject: Project = {
          id: project.id,
          name: project.name,
          description: project.description ?? '',
          overlayIds: [], // AI : We'll count overlays differently
          color: '#007bff', // AI : Default color
          cityId: project.cityId,
          status: project.status as 'pending' | 'approved' | 'rejected',
          ownerId: project.ownerId,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          metadata: project.metadata,
          city: project.city ? {
            id: project.city.id,
            name: project.city.name,
            countryCode: project.city.countryCode,
            coordinates: project.city.coordinates,
            createdAt: project.city.createdAt,
            updatedAt: project.city.updatedAt
          } : undefined,
          sourceUrl: project.sourceUrl,
          startDate: project.startDate,
          endDate: project.endDate,
          latestUpdateOn: project.latestUpdateOn,
          savedRemotely: true
        };
        
        projectMap.set(project.id, frontendProject);
      }
    });
    
    return Array.from(projectMap.values());
  });
  
  // AI : Function to get overlay count for a specific project
  const getOverlayCountForProject = (projectId: string): number => {
    return currentCityOverlays.value.filter(overlay => 
      overlay.project && overlay.project.id === projectId
    ).length;
  };
  
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