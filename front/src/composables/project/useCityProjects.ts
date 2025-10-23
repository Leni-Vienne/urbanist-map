import { computed } from 'vue';
import { useMapStore } from '@stores/pinia/mapStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import type { Project } from '@types';
import { createProject, createProjectFromAPI } from '../../utils/typeFactories';

/**
 * AI : Composable to get all accessible projects including:
 * - Projects from current city overlays
 * - Nearby projects from other cities (lazy loaded)
 * - Local unsaved projects
 */

export function useCityProjects() {
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  const projects = computed(() => {
    const projectMap = new Map<string, Project>();

    // AI : 1. Include local projects first (highest priority - may have unsaved changes)
    Object.values(projectStore.projects).forEach(project => {
      projectMap.set(project.id, project);
    });

    // AI : 2. Extract projects from current city overlays (only if not in local store)
    mapStore.currentCityOverlays.forEach(overlay => {
      if (overlay.project?.id && !projectMap.has(overlay.project.id)) {
        const frontendProject = createProject({
          ...overlay.project,
          description: overlay.project.description ?? null,
          overlayIds: []
        });
        projectMap.set(overlay.project.id, frontendProject);
      }
    });

    // AI : 3. Include nearby projects from other cities (only if not already added)
    projectStore.nearbyProjects.forEach(nearbyProject => {
      if (!projectMap.has(nearbyProject.id)) {
        const frontendProject = createProjectFromAPI(nearbyProject);
        projectMap.set(nearbyProject.id, frontendProject);
      }
    });

    return Array.from(projectMap.values());
  });
  
  const projectsWithCounts = computed(() => {
    return projects.value.map(project => ({
      ...project,
      overlayCount: getOverlayCountForProject(project.id)
    }));
  });

  // AI : Get overlay count, checking both current city and nearby project data
  function getOverlayCountForProject(projectId: string): number {
    // AI : Count from current city overlays
    const cityCount = mapStore.currentCityOverlays.filter(overlay =>
      overlay.project?.id === projectId
    ).length;
    
    // AI : If no overlays in current city, use count from nearby project data
    if (cityCount === 0) {
      const nearbyProject = projectStore.nearbyProjects.find(p => p.id === projectId);
      return nearbyProject?.overlayCount ?? 0;
    }
    
    return cityCount;
  }

  // AI : Group projects by city for visual organization
  const projectsByCity = computed(() => {
    const groups = new Map<string, Project[]>();
    
    projects.value.forEach(project => {
      const cityKey = project.city 
        ? `${project.city.name}, ${project.city.countryCode}`
        : 'Unknown Location';
      
      if (!groups.has(cityKey)) {
        groups.set(cityKey, []);
      }
      groups.get(cityKey)!.push(project);
    });
    
    return Array.from(groups.entries()).map(([cityName, projects]) => ({
      label: cityName,
      items: projects
    }));
  });

  // AI : Lazy load nearby projects
  async function loadNearbyProjects() {
    await projectStore.fetchNearbyProjects();
  }

  return {
    projects,
    projectsWithCounts,
    projectsByCity,
    getOverlayCountForProject,
    loadNearbyProjects
  };
}