import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { toggleEditMode } from '@composables/overlay/useOverlayModes'
import { storeToRefs } from 'pinia'

// AI : Composable for handling add overlay button click logic
export function useAddOverlay() {
  const authStore = useAuthStore()
  const uiStore = useUiStore()
  const overlayStore = useOverlayStore()
  const { isEditMode } = storeToRefs(overlayStore)

  function handleAddOverlayButtonClick() {
    if (!authStore.isAuthenticated) {
      uiStore.openAuthModal()
      return { success: false, reason: 'not_authenticated' }
    }

    if (!(isEditMode?.value ?? false)) {
      try {
        toggleEditMode()
        return { success: true, action: 'edit_mode_enabled' }
      } catch (error) {
        console.error('AI : Error toggling edit mode:', error)
        return { success: false, reason: 'edit_mode_error', error }
      }
    } else {
      uiStore.openImageUploadDialog()
      return { success: true, action: 'dialog_opened' }
    }
  }

  return {
    handleAddOverlayButtonClick
  }
}