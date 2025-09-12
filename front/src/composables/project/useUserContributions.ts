// AI : Composable for managing user contributions with caching
import { computed } from 'vue'
import { useProjectStore } from '@stores/pinia/projectStore'
import { trpc } from '@client'

export function useUserContributions() {
  const projectStore = useProjectStore()

  const isLoading = computed(() => projectStore.userContributionsLoading)
  const projects = computed(() => projectStore.userContributions)

  // AI : Fetch user contributions - load once
  async function fetchUserContributions() {
    try {
      // AI : Skip if already loaded
      if (projectStore.userContributionsLoaded) {
        return
      }

      projectStore.setUserContributionsLoading(true)
      const result = await trpc.project.getUsersContributions.query({
        limit: 50
      })
      projectStore.setUserContributions(result)
    } catch (error) {
      console.error('Error fetching user contributions:', error)
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