import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { switchMode } from '@composables/overlay/useOverlayModes'
import { storeToRefs } from 'pinia'

// AI : Composable for handling add button click logic (opens marker placement bar)
export function useAddOverlay() {
  const authStore = useAuthStore()
  const uiStore = useUiStore()
  const overlayStore = useOverlayStore()
  const { mode } = storeToRefs(overlayStore)

  async function handleAddOverlayButtonClick() {
    if (!authStore.isAuthenticated) {
      uiStore.openAuthModal()
      return { success: false, reason: 'not_authenticated' }
    }

    if (mode.value !== 'edit') {
      try {
        await switchMode('edit')
        return { success: true, action: 'edit_mode_enabled' }
      } catch (error) {
        console.error('Error switching to edit mode:', error)
        return { success: false, reason: 'edit_mode_error', error }
      }
    } else {
      // AI : Open marker placement bar
      uiStore.openMarkerPlacementBar()
      return { success: true, action: 'marker_placement_opened' }
    }
  }

  return {
    handleAddOverlayButtonClick
  }
}