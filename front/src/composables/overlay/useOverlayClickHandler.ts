import { navigateToOverlayWithCity } from '@composables/navigation/useOverlayNavigation'
import { navigateToOverlay } from '@composables/overlay/useOverlay'
import { switchMode } from '@composables/overlay/useOverlayModes'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'
import type { OverlayForModeration } from '@types'
import type { LatestContribution } from '../../types/api'

// AI : Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = OverlayForModeration | LatestContribution

/**
 * AI : Shared composable for handling overlay clicks from moderation/contribution panels
 * AI : Handles pending overlay visibility and proper navigation flow
 */
export function useOverlayClickHandler() {
  const toast = useToast()
  const { t } = useI18n()

  /**
   * AI : Navigate to an overlay, handling all necessary state changes
   * AI : - Switches to edit mode if in view mode (required to see pending overlays)
   * AI : - In moderation mode, don't switch modes (pending overlays already visible)
   * AI : - Clears city cache to force reload
   * AI : - Uses city-aware navigation when possible for better UX
   */
  async function handleOverlayClickNavigation(overlay: NavigableOverlay, shouldToggleEditMode = false): Promise<void> {
    try {
      // AI : Check if overlay is rejected or replaced and show appropriate message
      if (overlay.status === 'rejected' || overlay.status === 'replaced') {
        const messageKey = overlay.status === 'rejected' ? 'rejected' : 'replaced'
        toast.add({
          severity: 'info',
          summary: t('overlay.unavailable.title'),
          detail: t(`overlay.unavailable.${messageKey}`),
          life: 4000
        })
        return
      }

      const overlayStore = useOverlayStore()
      const mapStore = useMapStore()

      // AI : Clear city cache when navigating to pending overlays
      // AI : This ensures we reload with the correct mode to see pending items
      if (shouldToggleEditMode && overlay.cityId) {
        mapStore.clearCityProjectsCache(overlay.cityId)
        mapStore.clearCityStandaloneProjectsCache(overlay.cityId)
      }

      // AI : Only switch to edit mode if currently in view mode
      // AI : In moderation mode, pending overlays are already visible, so don't switch
      if (overlayStore.mode === 'view' && shouldToggleEditMode) {
        await switchMode('edit')

        // AI : Only show toast for pending overlays (for approved ones it's less critical)
        if (overlay.status === 'pending') {
          toast.add({
            severity: 'info',
            summary: 'Switched to Edit Mode',
            detail: 'Pending overlays are only visible in edit mode',
            life: 3000
          })
        }

        // AI : Wait for edit mode transition to complete and overlays to re-render
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // AI : If overlay has city info, navigate via city (loads city markers and overlays first)
      if (overlay.cityId && overlay.cityName) {
        await navigateToOverlayWithCity(overlay.id, overlay.cityId, overlay.cityName, overlay.countryCode ?? undefined)
      } else {
        // AI : Fallback to direct navigation if no city info
        await navigateToOverlay(overlay.id, true, true)
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
