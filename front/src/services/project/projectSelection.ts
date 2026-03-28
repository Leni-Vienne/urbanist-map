// Combines city projects retrieval and selected project state management
import { computed } from "vue";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import type { Project } from "@/types/index";
import { createProjectObject } from "@/utils/typeFactories";

/**
 * Get all accessible projects including:
 * - Projects from current city overlays
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

    return [...projectMap.values()];
  });

  return {
    projects,
  };
}
