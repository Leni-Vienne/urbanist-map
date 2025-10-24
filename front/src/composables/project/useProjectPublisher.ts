import { ref } from 'vue';
import { useMapStore } from '@stores/pinia/mapStore';
import { trpc } from '@client';
import { loadCityProjects } from '@composables/map/useCityMarkers';
import { buildProjectPayload } from './useProjectMutations';
import type { Project } from '@types';

export function useProjectPublisher() {
  const isPublishing = ref(false);
  const mapStore = useMapStore();

  // AI : Publish project to backend (both overlay and development projects)
  async function publishProject(project: Project): Promise<boolean> {
    if (!project) {
      console.warn('AI: Project is required for publishing');
      return false;
    }

    isPublishing.value = true;

    try {
      // AI : Use shared helper to build consistent payload
      const publishResult = await trpc.project.publishProject.mutate(
        buildProjectPayload(project)
      );

      if (publishResult.success) {
        // AI : Refresh city projects to show updated marker
        if (mapStore.selectedCity) {
          await loadCityProjects(
            mapStore.selectedCity.id,
            mapStore.selectedCity.name,
            true,
            mapStore.selectedCity.countryCode
          );
        } else {
          await loadCityProjects(null, '', true);
        }

        return true;
      } else {
        throw new Error('Backend publish failed');
      }
    } catch (error) {
      console.error('AI: Error publishing project:', error);
      throw error;
    } finally {
      isPublishing.value = false;
    }
  }

  return {
    isPublishing,
    publishProject
  };
}
