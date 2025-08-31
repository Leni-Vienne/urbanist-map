import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, Country } from '@types';
import type { NearbyProject } from '../../types/api';
import { map } from '@composables/core/useMap';
import { trpc } from '@client';
import { convertNearbyProjectToLocal } from '../../utils/projectConverters';

export const useProjectStore = defineStore('project', () => {
  // AI : Central store for project data to avoid circular dependencies
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  // AI : Centralized nearby projects data management
  const nearbyProjects = ref<NearbyProject[]>([]);
  const nearbyProjectsLoading = ref(false);
  const nearbyProjectsError = ref<string | null>(null);

  // AI : Computed property for combined projects (local + nearby)
  const allProjects = computed(() => {
    const combined = { ...projects.value };

    // AI : Add nearby projects that aren't already in local projects
    nearbyProjects.value.forEach((nearbyProject: NearbyProject) => {
      combined[nearbyProject.id] ??= convertNearbyProjectToLocal(nearbyProject);
    });

    return combined;
  });

  // AI : Writable computed for selected project ID  
  const selectedProjectIdRef = computed({
    get: () => selectedProjectId.value,
    set: (value: string | null) => {
      selectedProjectId.value = value;
    }
  });

  // AI : Nearby projects management actions
  async function fetchNearbyProjects(): Promise<NearbyProject[]> {
    try {
      nearbyProjectsLoading.value = true;
      nearbyProjectsError.value = null;

      if (!map.value) {
        console.warn('Map not available for fetching nearby projects');
        return [];
      }

      // AI : Get current map center coordinates
      const center = map.value.getCenter();

      // AI : Call the TRPC endpoint to fetch nearby projects
      const response = await trpc.project.getProjectsNearLocation.query({
        lat: center.lat,
        lng: center.lng,
      });

      nearbyProjects.value = response.projects;
      return response.projects;
    } catch (err) {
      console.error('Error fetching nearby projects:', err);
      nearbyProjectsError.value = err instanceof Error ? err.message : 'Failed to fetch nearby projects';
      return [];
    } finally {
      nearbyProjectsLoading.value = false;
    }
  }

  function setNearbyProjects(projectsData: NearbyProject[]) {
    nearbyProjects.value = projectsData;
    nearbyProjectsError.value = null;
  }

  function clearNearbyProjects(): void {
    nearbyProjects.value = [];
    nearbyProjectsError.value = null;
  }

  function setNearbyProjectsLoading(loading: boolean): void {
    nearbyProjectsLoading.value = loading;
  }

  function setNearbyProjectsError(error: string | null): void {
    nearbyProjectsError.value = error;
  }

  /**
   * AI : Add an overlay to a project by ID
   * @param projectId - The ID of the project
   * @param overlayId - The ID of the overlay to add
   */
  function addOverlayToProjectWithId(projectId: string, overlayId: string) {
    const project = projects.value[projectId];
    if (project) {
      if (!project.overlayIds.includes(overlayId)) {
        project.overlayIds.push(overlayId);
        // AI : Local storage removed - changes are now stored only in memory during edit mode
      }
    }
  }


  return {
    // State
    projects,
    selectedProjectId,
    countries,
    nearbyProjects,
    nearbyProjectsLoading,
    nearbyProjectsError,

    // Computed properties
    allProjects,
    selectedProjectIdRef,

    // Local project actions
    addOverlayToProjectWithId,

    // Nearby projects actions
    fetchNearbyProjects,
    setNearbyProjects,
    clearNearbyProjects,
    setNearbyProjectsLoading,
    setNearbyProjectsError
  };
});
