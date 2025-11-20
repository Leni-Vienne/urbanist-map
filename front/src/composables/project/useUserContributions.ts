import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'

export function useUserContributions() {
  const projectStore = useProjectStore()
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
        projectStore.removeOverlayFromUserContributions(overlayId)
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
        projectStore.removeProjectFromUserContributions(projectId)
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