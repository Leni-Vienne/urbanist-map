import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'
import { removeOverlay } from '@composables/overlay/useOverlay'
import { getStandaloneProjectMarkerByProjectId } from '@composables/map/useStandaloneProjectMarkers'
import { map } from '@composables/core/useMap'

export function useUserContributions() {
  const projectStore = useProjectStore()
  const mapStore = useMapStore()
  const overlayStore = useOverlayStore()
  const toast = useToast()
  const { t } = useI18n()

  const isLoading = computed(() => projectStore.userContributionsLoading)
  const projects = computed(() => projectStore.userContributions)

  async function fetchUserContributions() {
    if (projectStore.userContributionsLoaded) {
      return
    }

    projectStore.setUserContributionsLoading(true)
    try {
      const result = await withErrorHandling(
        async () => trpc.project.getUsersContributions.query({ limit: 50 }),
        { errorMessage: 'Failed to load contributions. Please refresh the page.' }
      )

      if (result) {
        projectStore.setUserContributions(result.projects)
      }
    } finally {
      projectStore.setUserContributionsLoading(false)
    }
  }

  async function deleteOverlay(overlayId: string): Promise<boolean> {
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.deleteOverlay.mutate({ id: overlayId }),
        { errorMessage: t('contributions.deleteOverlayError') }
      )

      if (result?.success) {
        // AI : Find the project that contains this overlay and remove the overlay ID from it
        const allProjectsData = projectStore.allProjects
        const projectWithOverlay = Object.values(allProjectsData).find(p =>
          p.overlayIds?.includes(overlayId)
        )

        if (projectWithOverlay) {
          // AI : Remove overlay ID from project's overlayIds array
          const updatedOverlayIds = projectWithOverlay.overlayIds.filter(id => id !== overlayId)
          projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds })
        }

        // AI : Remove from user contributions
        projectStore.removeOverlayFromUserContributions(overlayId)

        // AI : Remove from map and overlay store (this removes from overlayStore.overlays and allMarkers)
        removeOverlay(overlayId)

        // AI : Clear overlay from all overlay store caches
        overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter(o => o.id !== overlayId)
        overlayStore.loadedEditOverlays.delete(overlayId)

        // AI : Clear city cache to force reload when zooming (prevents ghost markers)
        mapStore.clearCityProjectsCache()
        mapStore.clearCityStandaloneProjectsCache()

        toast.add({
          severity: 'success',
          summary: t('contributions.overlayDeleted'),
          life: 3000
        })
        return true
      }
      return false
    } catch (error) {
      console.error('Error deleting overlay:', error)
      return false
    }
  }

  async function deleteProject(projectId: string): Promise<boolean> {
    try {
      const result = await withErrorHandling(
        async () => trpc.project.deleteProject.mutate({ id: projectId }),
        { errorMessage: t('contributions.deleteProjectError') }
      )

      if (result?.success) {
        // AI : Get project to check if it has overlays
        const project = projectStore.allProjects[projectId]

        // AI : Remove from user contributions
        projectStore.removeProjectFromUserContributions(projectId)

        // AI : If project has no overlays, remove its marker from the map
        const hasNoOverlays = !project?.overlayIds || project.overlayIds.length === 0
        if (hasNoOverlays) {
          const marker = getStandaloneProjectMarkerByProjectId(projectId)
          if (marker && map.value) {
            map.value.removeLayer(marker)
          }
        }

        // AI : Remove all overlays for this project from the map and caches
        if (project?.overlayIds) {
          project.overlayIds.forEach(overlayId => {
            removeOverlay(overlayId)
            // AI : Clear from overlay store caches
            overlayStore.viewModeOverlays = overlayStore.viewModeOverlays.filter(o => o.id !== overlayId)
            overlayStore.loadedEditOverlays.delete(overlayId)
          })
        }

        // AI : Remove project from main project store
        if (projectStore.projects[projectId]) {
          delete projectStore.projects[projectId]
        }

        // AI : Clear city caches to force reload when zooming (prevents ghost markers)
        mapStore.clearCityProjectsCache()
        mapStore.clearCityStandaloneProjectsCache()

        toast.add({
          severity: 'success',
          summary: t('contributions.projectDeleted'),
          life: 3000
        })
        return true
      }
      return false
    } catch (error) {
      console.error('Error deleting project:', error)
      return false
    }
  }

  return {
    isLoading,
    projects,
    fetchUserContributions,
    deleteOverlay,
    deleteProject
  }
}