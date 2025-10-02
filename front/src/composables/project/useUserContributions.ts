// AI : Composable for managing user contributions with caching
import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'

export function useUserContributions() {
  const projectStore = useProjectStore()

  const isLoading = computed(() => projectStore.userContributionsLoading)
  const projects = computed(() => projectStore.userContributions)

  // AI : Fetch user contributions - load once
  async function fetchUserContributions() {
    // AI : Skip if already loaded
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
        projectStore.setUserContributions(result)
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