// AI : Shared overlay edit mode cache utilities
import { useOverlayStore } from '@stores/pinia/overlayStore'
import type { OverlayData } from '@types'

/**
 * AI : Get overlay data with edit modifications applied (for edit mode)
 * This function checks if there are any edit mode modifications cached and applies them
 *
 * @param overlayData - Original overlay data from backend
 * @returns Overlay data with edit modifications applied if in edit mode
 */
export function getOverlayDataWithEditModifications(overlayData: OverlayData): OverlayData {
  const overlayStore = useOverlayStore()

  if (overlayStore.mode !== 'edit') {
    return overlayData
  }

  const editModifications = overlayStore.getFromEditModeCache(overlayData.id)

  if (editModifications) {
    return {
      ...overlayData,
      corners: editModifications.corners,
      isModified: editModifications.isModified
    }
  }

  return overlayData
}

/**
 * AI : Save overlay modifications to edit mode cache
 *
 * @param overlayId - ID of the overlay
 * @param corners - Corner coordinates
 * @param isModified - Whether the overlay has been modified
 */
export function saveToEditModeOverlayCache(
  overlayId: string,
  data: { corners: { lat: number, lng: number }[], isModified: boolean }
): void {
  const overlayStore = useOverlayStore()
  overlayStore.saveToEditModeCache(overlayId, data)
}

/**
 * AI : Get overlay modifications from edit mode cache
 *
 * @param overlayId - ID of the overlay
 * @returns Cached modifications or undefined
 */
export function getFromEditModeOverlayCache(
  overlayId: string
): { corners: { lat: number, lng: number }[], isModified: boolean } | undefined {
  const overlayStore = useOverlayStore()
  return overlayStore.getFromEditModeCache(overlayId)
}

/**
 * AI : Clear all edit mode cache
 */
export function clearEditModeOverlayCache(): void {
  const overlayStore = useOverlayStore()
  overlayStore.clearEditModeCache()
}
