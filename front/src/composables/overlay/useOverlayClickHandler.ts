import { navigateToOverlayWithCity } from '@composables/navigation/useOverlayNavigation'
import { navigateToOverlay } from '@composables/overlay/useOverlay'
import { toggleEditMode } from '@composables/overlay/useOverlayModes'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useToast } from '@composables/ui/useToast'
import type { OverlayForModeration } from '@types'
import type { LatestOverlay } from '../../types/api'

// AI : Union type to accept overlays from both moderation panels and latest overlays panel
type NavigableOverlay = OverlayForModeration | LatestOverlay

/**
 * AI : Shared composable for handling overlay clicks from moderation/contribution panels
 * AI : Handles pending overlay visibility and proper navigation flow
 */
export function useOverlayClickHandler() {
  const toast = useToast()

  /**
   * AI : Navigate to an overlay, handling all necessary state changes
   * AI : - Switches to edit mode if not already enabled (required to see overlays)
   * AI : - Clears city cache to force reload
   * AI : - Uses city-aware navigation when possible for better UX
   */
  async function handleOverlayClickNavigation(overlay: NavigableOverlay) {
    try {
      const overlayStore = useOverlayStore()
      const mapStore = useMapStore()

      // AI : Ensure edit mode is enabled before navigating
      if (!overlayStore.isEditMode) {
        await toggleEditMode()

        // AI : Only show toast for pending overlays (for approved ones it's less critical)
        if (overlay.status === 'pending') {
          toast.add({
            severity: 'info',
            summary: 'Switched to Edit Mode',
            detail: 'Pending overlays are only visible in edit mode',
            life: 3000
          })
        }

        // AI : Clear city cache to force reload with edit mode enabled
        if (overlay.cityId) {
          mapStore.clearCityProjectsCache(overlay.cityId)
          mapStore.clearCityDevelopmentProjectsCache(overlay.cityId)
        }

        // AI : Wait for edit mode transition to complete and overlays to re-render
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // AI : If overlay has city info, navigate via city (loads city markers and overlays first)
      if (overlay.cityId && overlay.cityName) {
        await navigateToOverlayWithCity(overlay.id, overlay.cityId, overlay.cityName, overlay.countryCode ?? undefined)
      } else {
        // AI : Fallback to direct navigation if no city info
        await navigateToOverlay(overlay.id)
      }
    } catch (error) {
      console.error('Failed to navigate to overlay:', error)
      toast.add({
        severity: 'error',
        summary: 'Navigation Failed',
        detail: error instanceof Error ? error.message : 'Failed to navigate to overlay',
        life: 3000
      })
    }
  }

  return {
    handleOverlayClickNavigation
  }
}
