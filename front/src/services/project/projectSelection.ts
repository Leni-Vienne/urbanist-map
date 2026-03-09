// Combines city projects retrieval and selected project state management
import { computed } from "vue";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import type { Project } from "@/types/index";
import { createProjectObject, createProjectObjectFromAPI } from "@/utils/typeFactories";

/**
 * Get all accessible projects including:
 * - Projects from current city overlays
 * - Nearby projects from other cities (lazy loaded)
 * - Local unsaved projects
 */
export function getCityProjects() {
  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  const projects = computed(() => {
    const projectMap = new Map<string, Project>();

    // 1. Include local projects first (highest priority - may have unsaved changes)
    for (const project of Object.values(projectStore.projects)) {
      projectMap.set(project.id, project);
    }

    // 2. Extract projects from current city overlays (only if not in local store)
    for (const overlay of mapStore.currentCityOverlays) {
      if (overlay.project?.id && !projectMap.has(overlay.project.id)) {
        const frontendProject = createProjectObject({
          ...overlay.project,
          description: overlay.project.description ?? null,
          overlayIds: [],
          geometry: overlay.project.geometry ?? null,
        });
        projectMap.set(overlay.project.id, frontendProject);
      }
    }

    // 3. Include nearby projects from other cities (only if not already added)
    for (const nearbyProject of projectStore.nearbyProjects) {
      if (!projectMap.has(nearbyProject.id)) {
        const frontendProject = createProjectObjectFromAPI(nearbyProject);
        projectMap.set(nearbyProject.id, frontendProject);
      }
    }

    return [...projectMap.values()];
  });

  const projectsWithCounts = computed(() => {
    return projects.value.map((project) => ({
      ...project,
      overlayCount: getOverlayCountForProject(project.id),
    }));
  });

  // Get overlay count, checking both current city and nearby project data
  function getOverlayCountForProject(projectId: string): number {
    // Count from current city overlays
    const cityCount = mapStore.currentCityOverlays.filter(
      (overlay) => overlay.project?.id === projectId,
    ).length;

    // If no overlays in current city, use count from nearby project data
    if (cityCount === 0) {
      const nearbyProject = projectStore.nearbyProjects.find((p) => p.id === projectId);
      return nearbyProject?.overlayCount ?? 0;
    }

    return cityCount;
  }

  // Group projects by city for visual organization
  const projectsByCity = computed(() => {
    const groups = new Map<string, Project[]>();

    for (const project of projects.value) {
      const cityKey = `${project.city.name}, ${project.city.countryCode}`;

      let list = groups.get(cityKey);
      if (!list) {
        list = [];
        groups.set(cityKey, list);
      }
      list.push(project);
    }

    return [...groups.entries()].map(([cityName, projectList]) => ({
      label: cityName,
      items: projectList,
    }));
  });

  return {
    projects,
    projectsWithCounts,
    projectsByCity,
    getOverlayCountForProject,
  };
}

// ============================================================================
// SELECTED PROJECT
// ============================================================================

/**
 * Computed ref for managing the globally selected project ID
 * This provides a centralized way to access and modify the selected project
 * across all components, preventing state inconsistencies.
 */
export function getSelectedProjectId() {
  const projectStore = useProjectStore();

  return computed({
    get: () => projectStore.selectedProjectId,
    set: (value: string | null) => {
      projectStore.selectedProjectId = value;
    },
  });
}
