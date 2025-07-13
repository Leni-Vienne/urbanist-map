import { ref, computed } from 'vue';
import { trpc } from '@client';
import { map } from '@composables/core/useMap';
import type { NearbyProject } from '../../types/api';

// AI : Reactive state for nearby projects
const nearbyProjects = ref<NearbyProject[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

/**
 * AI : Fetch projects near the current camera location
 */
export async function fetchNearbyProjects(): Promise<NearbyProject[]> {
  if (!map.value) {
    console.warn('Map not available for fetching nearby projects');
    return [];
  }

  isLoading.value = true;
  error.value = null;

  try {
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
    error.value = err instanceof Error ? err.message : 'Failed to fetch nearby projects';
    return [];
  } finally {
    isLoading.value = false;
  }
}

/**
 * AI : Get the current nearby projects
 */
export function getNearbyProjects() {
  return {
    projects: computed(() => nearbyProjects.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value)
  };
}

/**
 * AI : Clear the nearby projects cache
 */
export function clearNearbyProjects() {
  nearbyProjects.value = [];
  error.value = null;
}
