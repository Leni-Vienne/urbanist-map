// AI : Composable for managing latest contributions (overlays + development projects) with caching
import { computed } from 'vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'

export function useLatestContributions() {
  const overlayStore = useOverlayStore()

  const isLoading = computed(() => overlayStore.latestContributionsLoading)
  const contributions = computed(() => overlayStore.latestContributions)

  // AI : Fetch latest contributions - load once
  async function fetchLatestContributions() {
    // AI : Skip if already loaded
    if (overlayStore.latestContributionsLoaded) {
      return
    }

    overlayStore.setLatestContributionsLoading(true)
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.getLatestContributions.query({ limit: 20 }),
        { errorMessage: 'Failed to load latest contributions. Please refresh the page.' }
      )

      if (result) {
        overlayStore.setLatestContributions(result)
      }
    } finally {
      overlayStore.setLatestContributionsLoading(false)
    }
  }

  return {
    isLoading,
    contributions,
    fetchLatestContributions
  }
}
