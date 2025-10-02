// AI : Composable for managing latest overlays with caching
import { computed } from 'vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { trpc } from '@client'
import { withErrorHandling } from '@composables/core/useErrorHandling'

export function useLatestOverlays() {
  const overlayStore = useOverlayStore()

  const isLoading = computed(() => overlayStore.latestOverlaysLoading)
  const overlays = computed(() => overlayStore.latestOverlays)

  // AI : Fetch latest overlays - load once
  async function fetchLatestOverlays() {
    // AI : Skip if already loaded
    if (overlayStore.latestOverlaysLoaded) {
      return
    }

    overlayStore.setLatestOverlaysLoading(true)
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.getLatestOverlays.query({ limit: 20 }),
        { errorMessage: 'Failed to load latest overlays. Please refresh the page.' }
      )

      if (result) {
        overlayStore.setLatestOverlays(result)
      }
    } finally {
      overlayStore.setLatestOverlaysLoading(false)
    }
  }

  return {
    isLoading,
    overlays,
    fetchLatestOverlays
  }
}