// AI : Composable for managing latest overlays with caching
import { computed } from 'vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { trpc } from '@client'

export function useLatestOverlays() {
  const overlayStore = useOverlayStore()

  const isLoading = computed(() => overlayStore.latestOverlaysLoading)
  const overlays = computed(() => overlayStore.latestOverlays)

  // AI : Fetch latest overlays - load once
  async function fetchLatestOverlays() {
    try {
      // AI : Skip if already loaded
      if (overlayStore.latestOverlaysLoaded) {
        return
      }

      overlayStore.setLatestOverlaysLoading(true)
      const result = await trpc.overlay.getLatestOverlays.query({
        limit: 20
      })
      overlayStore.setLatestOverlays(result)
    } catch (error) {
      console.error('Error fetching latest overlays:', error)
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