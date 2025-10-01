// AI : Unified store access pattern - single source of truth for store access
import { storeToRefs } from 'pinia'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useUiStore } from '@stores/uiStore'
import { useAuthStore } from '@stores/authStore'

/**
 * AI : Unified composable for accessing all stores with reactive refs and methods
 * This eliminates the need for getStoreRefs() functions scattered across the codebase
 *
 * All store methods and refs are automatically available - no need to use .actions
 *
 * @returns Object containing all store refs and methods
 *
 * @example
 * const { overlay, map, ui } = useStores()
 * overlay.overlays.value // reactive ref
 * overlay.setEditMode(true) // store method (no .actions needed!)
 * ui.closeProjectInfoPopup() // direct method call
 */
export function useStores() {
  // AI : Initialize stores
  const overlayStore = useOverlayStore()
  const projectStore = useProjectStore()
  const mapStore = useMapStore()
  const uiStore = useUiStore()
  const authStore = useAuthStore()

  // AI : Get reactive refs from stores
  const overlayRefs = storeToRefs(overlayStore)
  const projectRefs = storeToRefs(projectStore)
  const mapRefs = storeToRefs(mapStore)
  const uiRefs = storeToRefs(uiStore)
  const authRefs = storeToRefs(authStore)

  return {
    // AI : Overlay store - refs + all methods automatically available
    overlay: {
      ...overlayRefs,
      ...overlayStore,
      store: overlayStore,
    },

    // AI : Project store - refs + all methods automatically available
    project: {
      ...projectRefs,
      ...projectStore,
      store: projectStore,
    },

    // AI : Map store - refs + all methods automatically available
    map: {
      ...mapRefs,
      ...mapStore,
      store: mapStore,
    },

    // AI : UI store - refs + all methods automatically available
    ui: {
      ...uiRefs,
      ...uiStore,
      store: uiStore,
    },

    // AI : Auth store - refs + all methods automatically available
    auth: {
      ...authRefs,
      ...authStore,
      store: authStore,
    }
  }
}
