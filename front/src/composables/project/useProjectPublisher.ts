import { ref } from 'vue';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { trpc } from '@client';
import { storeToRefs } from 'pinia';
import { loadCityProjects } from '@composables/map/useCityMarkers';
import type { Project } from '@types';

export function useProjectPublisher() {
  const isPublishing = ref(false);
  const projectStore = useProjectStore();
  const mapStore = useMapStore();
  const { projects } = storeToRefs(projectStore);

  // AI : Publish development project to backend
  async function publishProject(project: Project): Promise<boolean> {
    if (!project || !project.isDevelopment) {
      console.warn('AI: Only development projects can be published via this function');
      return false;
    }

    isPublishing.value = true;

    try {
      const publishResult = await trpc.project.publishProject.mutate({
        id: project.id,
        name: project.name!,
        description: project.description ?? undefined,
        isDevelopment: project.isDevelopment,
        lat: project.lat ?? undefined,
        lng: project.lng ?? undefined,
        cityId: project.cityId ?? undefined,
      });

      if (publishResult.success) {
        // AI : Mark project as saved remotely
        if (projects.value[project.id]) {
          projects.value[project.id] = {
            ...projects.value[project.id],
            savedRemotely: true
          };
        }

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
