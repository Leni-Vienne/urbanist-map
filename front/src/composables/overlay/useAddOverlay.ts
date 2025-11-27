import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { switchMode } from '@composables/overlay/useOverlayModes'
import { storeToRefs } from 'pinia'

// AI : Composable for handling add button click logic (opens marker placement bar)
export function useAddOverlay() {
  const authStore = useAuthStore()
  const uiStore = useUiStore()
  const overlayStore = useOverlayStore()
  const projectStore = useProjectStore()
  const { mode } = storeToRefs(overlayStore)

  async function handleAddOverlayButtonClick() {
    if (!authStore.isAuthenticated) {
      uiStore.openAuthModal()
      return { success: false, reason: 'not_authenticated' }
    }

    // AI : Smart behavior: check if user has any contributions
    const userProjects = Object.values(projectStore.projects).filter(
      p => p.ownerId === authStore.user?.id
    )
    const hasContributions = userProjects.length > 0

    if (mode.value !== 'edit') {
      // AI : If user has no contributions, skip edit mode and open dialog directly
      if (!hasContributions) {
        uiStore.openMarkerPlacementBar()
        return { success: true, action: 'dialog_opened' }
      }

      // AI : If user has contributions, switch to edit mode AND open dialog in one click
      try {
        await switchMode('edit')
        uiStore.openMarkerPlacementBar()
        return { success: true, action: 'edit_mode_and_dialog_opened' }
      } catch (error) {
        console.error('Error switching to edit mode:', error)
        return { success: false, reason: 'edit_mode_error', error }
      }
    } else {
      // AI : Already in edit mode - just open marker placement bar
      uiStore.openMarkerPlacementBar()
      return { success: true, action: 'dialog_opened' }
    }
  }

  return {
    handleAddOverlayButtonClick
  }
}