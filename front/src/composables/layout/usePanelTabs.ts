import { watch, type Ref } from 'vue'
import { useAuthStore } from '@stores/authStore'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { updateOverlayEditingState } from '@composables/overlay/useOverlay'
import type { MapMode } from '@types'

// AI : Type for available tabs in side menu and mobile drawer
export type PanelTab = 'latest' | 'uploads' | 'moderation'

/**
 * AI : Composable for managing panel tabs and mode synchronization
 * AI : Shared between SideMenu.vue and MobileDrawer.vue
 */
export function usePanelTabs(initialTab: Ref<PanelTab>) {
  const authStore = useAuthStore()
  const overlayStore = useOverlayStore()

  // AI : Flag to prevent infinite loops when syncing tab and mode
  let isSyncing = false

  /**
   * AI : Map tab to overlay mode
   */
  function tabToMode(tab: PanelTab): MapMode {
    switch (tab) {
      case 'latest': return 'view'
      case 'uploads': return 'edit'
      case 'moderation': return 'moderation'
      default: return 'view'
    }
  }

  /**
   * AI : Map overlay mode to tab
   */
  function modeToTab(mode: MapMode): PanelTab {
    switch (mode) {
      case 'view': return 'latest'
      case 'edit': return 'uploads'
      case 'moderation': return 'moderation'
      default: return 'latest'
    }
  }

  /**
   * AI : Watch activeTab and sync mode - lightweight update without full state machine
   */
  watch(initialTab, async (newTab) => {
    if (isSyncing) return
    isSyncing = true

    const newMode = tabToMode(newTab)

    if (overlayStore.mode !== newMode) {
      // AI : Set the mode first
      overlayStore.setMode(newMode)
      
      // AI : Update overlay toolbar to reflect new mode (draggable, actions)
      // AI : This preserves selection because updateOverlayEditingState() has selection restoration logic
      updateOverlayEditingState()
    }

    isSyncing = false
  })

  /**
   * AI : Watch mode and sync activeTab
   */
  watch(() => overlayStore.mode, (newMode) => {
    if (isSyncing) return
    isSyncing = true

    const newTab = modeToTab(newMode)
    if (initialTab.value !== newTab) {
      initialTab.value = newTab
    }

    isSyncing = false
  })

  /**
   * AI : Watch for authentication changes and reset tab if user signs out
   */
  watch(() => authStore.isAuthenticated, (isAuthenticated) => {
    if (!isAuthenticated && (initialTab.value === 'uploads' || initialTab.value === 'moderation')) {
      initialTab.value = 'latest'
    }
  })

  /**
   * AI : Watch for moderation role changes and reset moderation tab if user loses rights
   */
  watch(() => authStore.isModerator, (isModerator) => {
    if (!isModerator && initialTab.value === 'moderation') {
      initialTab.value = 'latest'
    }
  })

  return {
    authStore,
    tabToMode,
    modeToTab,
  }
}
