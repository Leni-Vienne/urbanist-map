import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'

export function useUserContributions() {
  const projectStore = useProjectStore()

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

  return {
    isLoading,
    projects,
    fetchUserContributions
  }
}