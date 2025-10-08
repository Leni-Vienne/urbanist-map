// AI : Manages caching of overlay positions for edit mode
// AI : Separates cache logic from rendering and mode switching

import type { OverlayObject } from '@types'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import L from 'leaflet'

// AI : Cache entry structure (matches what's in overlayStore)
export interface CachedPosition {
  corners: { lat: number; lng: number }[]
  isModified: boolean
}

/**
 * AI : Get cached position for an overlay
 */
export function getCachedPosition(overlayId: string): CachedPosition | null {
  const overlayStore = useOverlayStore()
  const cached = overlayStore.getFromEditModeCache(overlayId)
  return cached ?? null
}

/**
 * AI : Save overlay position to cache
 */
export function saveCachedPosition(overlayId: string, corners: L.LatLng[], isModified: boolean): void {
  const overlayStore = useOverlayStore()

  const cacheData: CachedPosition = {
    corners: corners.map(corner => ({ lat: corner.lat, lng: corner.lng })),
    isModified,
  }

  overlayStore.saveToEditModeCache(overlayId, cacheData)
}

/**
 * AI : Save current position of an overlay object to cache
 */
export function cacheCurrentPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return

  const corners = overlayObject.overlay.getCorners()
  saveCachedPosition(
    overlayObject.id,
    corners as L.LatLng[],
    overlayObject.isModified ?? false
  )
}

/**
 * AI : Clear all cached positions
 */
export function clearAllCachedPositions(): void {
  const overlayStore = useOverlayStore()
  overlayStore.clearEditModeCache()
}

/**
 * AI : Apply cached or backend position to a single overlay
 * @param overlayObject - The overlay to update
 * @param useCache - If true, use cached position; if false, use backend position
 */
export function applyPositionToOverlay(overlayObject: OverlayObject, useCache: boolean): void {
  if (!overlayObject.overlay) return

  // AI : Check if overlay is actually on the map before manipulating it
  // AI : This prevents "Cannot read properties of null (reading 'getPane')" errors
  const map = (overlayObject.overlay as any)._map
  if (!map) {
    console.warn('Overlay not on map yet, skipping position update for', overlayObject.id)
    return
  }

  if (useCache) {
    // AI : Try to restore from cache first
    const cached = getCachedPosition(overlayObject.id)
    if (cached?.corners && cached.corners.length === 4) {
      const corners = cached.corners.map(c => L.latLng(c.lat, c.lng))
      overlayObject.overlay.setCorners(corners)
      overlayObject.isModified = cached.isModified
      return
    }
  }

  // AI : Fall back to backend positions (or if useCache is false)
  if (overlayObject.corners && overlayObject.corners.length === 4) {
    const corners: L.LatLng[] = overlayObject.corners.map(c => L.latLng(c.lat, c.lng))
    overlayObject.overlay.setCorners(corners)
    overlayObject.isModified = false
  }
}

/**
 * AI : Apply positions to multiple overlays (batch operation)
 */
export function applyPositionsToOverlays(overlays: OverlayObject[], useCache: boolean): void {
  overlays.forEach(overlay => {
    applyPositionToOverlay(overlay, useCache)
  })
}

/**
 * AI : Check if an overlay has cached position
 */
export function hasCachedPosition(overlayId: string): boolean {
  const cached = getCachedPosition(overlayId)
  return cached !== null && cached.corners.length === 4
}
