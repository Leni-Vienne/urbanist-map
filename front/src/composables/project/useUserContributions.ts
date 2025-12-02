import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'
import { removeOverlayFromMap } from '@composables/overlay/useOverlayRemoval'
import { getStandaloneProjectMarkerByProjectId } from '@composables/map/useStandaloneProjectMarkers'
import { addStandaloneProjectMarkerForProject } from '@composables/map/useStandaloneProjectMarkers'
import { map } from '@composables/core/useMap'

/**
 * AI : Non-composable overlay deletion function that can be called from anywhere
 * AI : Does not use Vue composables, safe to call from Leaflet toolbar handlers
 */
export async function deleteOverlayDirect(overlayId: string): Promise<boolean> {
  try {
    const projectStore = useProjectStore()

    const result = await withErrorHandling(
      async () => trpc.overlay.deleteOverlay.mutate({ id: overlayId }),
      { errorMessage: undefined }
    )

    const shouldCleanup = result?.success || !result

    if (shouldCleanup) {
      const allProjectsData = projectStore.allProjects
      const projectWithOverlay = Object.values(allProjectsData).find(p =>
        p.overlayIds?.includes(overlayId)
      )

      if (projectWithOverlay) {
        const updatedOverlayIds = projectWithOverlay.overlayIds.filter(id => id !== overlayId)
        projectStore.updateProject(projectWithOverlay.id, { overlayIds: updatedOverlayIds })

        const isLastOverlay = updatedOverlayIds.length === 0
        if (isLastOverlay && projectWithOverlay.lat && projectWithOverlay.lng) {
          setTimeout(() => {
            addStandaloneProjectMarkerForProject(projectWithOverlay)
          }, 150)
        }
      }

      removeOverlayFromMap(overlayId)

      const standaloneMarker = getStandaloneProjectMarkerByProjectId(overlayId)
      if (standaloneMarker && map.value) {
        map.value.removeLayer(standaloneMarker)
      }

      return true
    }

    return false
  } catch (error) {
    console.error('Failed to delete overlay:', error)
    return false
  }
}

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
      // AI : Try backend deletion first (will fail gracefully if overlay not in backend)
      const result = await withErrorHandling(
        async () => trpc.overlay.deleteOverlay.mutate({ id: overlayId }),
        { errorMessage: undefined } // AI : Suppress error toast - we'll handle locally if backend fails
      )

      // AI : Whether backend succeeded or failed, clean up local state
      const shouldCleanup = result?.success || !result

      if (shouldCleanup) {
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
        removeOverlayFromMap(overlayId)

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
      // AI : Get project to check if it's local-only (not submitted to backend)
      const project = projectStore.allProjects[projectId]
      const isLocalOnly = project?.status === null

      // AI : For local-only projects, skip backend call and just remove from local state
      if (isLocalOnly) {
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
            removeOverlayFromMap(overlayId)
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

      // AI : For backend projects, call the API
      const result = await withErrorHandling(
        async () => trpc.project.deleteProject.mutate({ id: projectId }),
        { errorMessage: t('contributions.deleteProjectError') }
      )

      if (result?.success) {
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
            removeOverlayFromMap(overlayId)
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