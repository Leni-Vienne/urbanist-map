import { ref, computed } from 'vue'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'

// AI : Type for moderated contribution item
export interface ModeratedContribution {
  id: string
  caption: string | null
  filename: string
  status: 'rejected' | 'replaced'
  updatedAt: Date
  projectId: string | null
  replacedByOverlayId: string | null
  projectName: string | null
}

const moderatedContributions = ref<ModeratedContribution[]>([])
const isLoading = ref(false)
const hasBeenFetched = ref(false)

/**
 * AI : Composable for managing moderated contributions (rejected/replaced overlays)
 * AI : Shows users what happened to their submissions after moderation
 * AI : Allows users to acknowledge and clean up these items immediately
 */
export function useModeratedContributions() {
  const hasUnacknowledgedItems = computed(() => moderatedContributions.value.length > 0)

  /**
   * AI : Fetch moderated contributions from backend
   * AI : Caches results so we don't refetch unnecessarily
   */
  async function fetchModeratedContributions(force = false) {
    if (hasBeenFetched.value && !force) {
      return
    }

    isLoading.value = true
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.getModeratedContributions.query(),
        { errorMessage: 'Failed to load moderated contributions' }
      )

      if (result) {
        moderatedContributions.value = result as ModeratedContribution[]
        hasBeenFetched.value = true
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * AI : Acknowledge and clear specific moderated items
   * AI : Deletes thumbnails and DB records immediately (instead of waiting 15 days)
   */
  async function acknowledgeContributions(overlayIds: string[]) {
    if (overlayIds.length === 0) return { success: false }

    const result = await withErrorHandling(
      async () => trpc.overlay.acknowledgeModeratedContributions.mutate({ overlayIds }),
      { errorMessage: 'Failed to acknowledge contributions' }
    )

    if (result?.success) {
      // AI : Remove acknowledged items from local cache
      moderatedContributions.value = moderatedContributions.value.filter(
        item => !overlayIds.includes(item.id)
      )
    }

    return result ?? { success: false }
  }

  /**
   * AI : Acknowledge all moderated contributions at once
   */
  async function acknowledgeAll() {
    const allIds = moderatedContributions.value.map(item => item.id)
    return acknowledgeContributions(allIds)
  }

  /**
   * AI : Reset cache (useful when user logs out)
   */
  function reset() {
    moderatedContributions.value = []
    hasBeenFetched.value = false
  }

  return {
    moderatedContributions,
    isLoading,
    hasUnacknowledgedItems,
    hasBeenFetched,
    fetchModeratedContributions,
    acknowledgeContributions,
    acknowledgeAll,
    reset
  }
}
