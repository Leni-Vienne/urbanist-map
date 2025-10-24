import L from 'leaflet'
import type { FitBoundsOptions, ZoomPanOptions } from 'leaflet'
import { map } from '@composables/core/useMap'
import { useUiStore } from '@stores/uiStore'


// minimum distance to prevent odd looking flyTo animations if user is already at target
const distanceThreshold = 0.00001

/**
 * AI : Check if mobile drawer is covering the map
 * AI : Only apply offset when on mobile AND drawer is open
 */
function shouldApplyMobileOffset(): boolean {
  const isMobile = window.innerWidth <= 768
  if (!isMobile) return false
  
  const uiStore = useUiStore()
  return uiStore.mobileDrawerVisible
}

/**
 * AI : Mobile-aware flyTo - adjusts center on mobile to account for drawer
 * AI : Strategy: Create a small bounds around the point and use flyToBounds with mobile-aware padding
 * AI : This leverages Leaflet's built-in padding logic which already works correctly
 */
export function mobileAwareFlyTo(
  latlng: L.LatLngExpression,
  zoom?: number,
  options?: ZoomPanOptions
): void {
  if (!map.value) return

  const latLng = L.latLng(latlng)
  const currentCenter = map.value.getCenter()
  const currentZoom = map.value.getZoom()
  const targetZoom = zoom ?? currentZoom

  // AI : Check if already at target location and zoom to prevent camera shake
  const distance = currentCenter.distanceTo(latLng)
  
  if (distance < distanceThreshold && Math.abs(currentZoom - targetZoom) < 0.1) {
    return // AI : Already at target, skip animation
  }

  if (!shouldApplyMobileOffset()) {
    // AI : Desktop or drawer closed - center normally
    map.value.flyTo([latLng.lat, latLng.lng], zoom, options)
    return
  }

  // AI : Mobile with drawer open - use flyToBounds with a tiny bounds around the point
  // AI : This leverages the working padding logic from mobileAwareFlyToBounds
  const offset = 0.001 // AI : Small offset to create minimal bounds
  const bounds = L.latLngBounds(
    [latLng.lat - offset, latLng.lng - offset],
    [latLng.lat + offset, latLng.lng + offset]
  )

  // AI : Use flyToBounds with mobile-aware padding and target zoom
  const fitOptions: FitBoundsOptions = {
    ...options,
    maxZoom: zoom ?? map.value.getZoom(),
    paddingTopLeft: [50, 50] as [number, number],
    paddingBottomRight: [50, window.innerHeight * 0.45] as [number, number]
  }

  map.value.flyToBounds(bounds, fitOptions)
}

/**
 * AI : Mobile-aware flyToBounds - uses asymmetric padding on mobile
 */
export function mobileAwareFlyToBounds(
  bounds: L.LatLngBoundsExpression,
  options?: FitBoundsOptions
): void {
  if (!map.value) return

  // AI : Convert bounds expression to LatLngBounds object for comparison
  const targetBounds = bounds instanceof L.LatLngBounds 
    ? bounds 
    : L.latLngBounds(bounds as L.LatLngBoundsLiteral)
  const currentBounds = map.value.getBounds()

  // AI : Check if already viewing the same bounds to prevent camera shake
  const sameNorth = Math.abs(currentBounds.getNorth() - targetBounds.getNorth()) < distanceThreshold
  const sameSouth = Math.abs(currentBounds.getSouth() - targetBounds.getSouth()) < distanceThreshold
  const sameEast = Math.abs(currentBounds.getEast() - targetBounds.getEast()) < distanceThreshold
  const sameWest = Math.abs(currentBounds.getWest() - targetBounds.getWest()) < distanceThreshold

  if (sameNorth && sameSouth && sameEast && sameWest) {
    return // AI : Already viewing these bounds, skip animation
  }

  const applyOffset = shouldApplyMobileOffset()
  const flyOptions: FitBoundsOptions = applyOffset
    ? {
        ...options,
        paddingTopLeft: [50, 50] as [number, number],
        paddingBottomRight: [50, window.innerHeight * 0.45] as [number, number] // AI : 45% to cover drawer + margin
      }
    : {
        ...options,
        padding: options?.padding ?? [50, 50] as [number, number]
      }

  map.value.flyToBounds(bounds, flyOptions)
}
