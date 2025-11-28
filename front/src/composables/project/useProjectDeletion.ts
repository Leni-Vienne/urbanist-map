import { useI18n } from 'vue-i18n'
import { useToast } from '@composables/ui/useToast'
import { useUserContributions } from '@composables/project/useUserContributions'
import { addDevelopmentMarkerForProject } from '@composables/map/useDevelopmentMarkers'
import { useProjectStore } from '@stores/pinia/projectStore'

export function useProjectDeletion() {
  const { t } = useI18n()
  const toast = useToast()
  const { deleteOverlay, deleteProject } = useUserContributions()
  const projectStore = useProjectStore()

  /**
   * AI : Delete an overlay with confirmation and auto-add development marker if it's the last one
   * AI : Project parameter accepts any object with id, lat, lng for development marker
   */
  async function handleDeleteOverlay(
    overlayId: string,
    project: { id: string; lat: number | null; lng: number | null } | null | undefined,
    projectOverlayCount: number,
    overlayName: string | null,
    onSuccess?: () => void
  ): Promise<boolean> {
    const confirmMessage = t('contributions.confirmDeleteOverlay', { name: overlayName || t('overlay.untitled') })
    if (!confirm(confirmMessage)) return false

    const isLastOverlay = projectOverlayCount === 1

    const success = await deleteOverlay(overlayId)
    if (!success) return false

    // AI : If it was the last overlay, add a development marker to show the project
    if (isLastOverlay && project?.id && project?.lat && project?.lng) {
      // AI : Get updated project from store, or use the passed project
      const updatedProject = projectStore.projects[project.id] || projectStore.allProjects[project.id] || project

      await new Promise(resolve => setTimeout(resolve, 150))
      addDevelopmentMarkerForProject(updatedProject)
      toast.add({
        severity: 'info',
        summary: t('overlay.lastOverlayDeleted'),
        detail: t('overlay.projectNowShowsAsMarker'),
        life: 4000
      })
    }

    onSuccess?.()
    return true
  }

  /**
   * AI : Delete a project with confirmation
   */
  async function handleDeleteProject(projectId: string, projectName: string, overlayCount: number, onSuccess?: () => void): Promise<boolean> {
    const confirmMessage = overlayCount > 0
      ? t('contributions.confirmDeleteProjectWithOverlays', { name: projectName, count: overlayCount })
      : t('contributions.confirmDeleteProject', { name: projectName })

    if (!confirm(confirmMessage)) return false

    const success = await deleteProject(projectId)
    if (!success) return false

    onSuccess?.()
    return true
  }

  return {
    handleDeleteOverlay,
    handleDeleteProject
  }
}
