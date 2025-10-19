import L from 'leaflet'
import type { FitBoundsOptions, ZoomPanOptions } from 'leaflet'
import { map } from '@composables/core/useMap'
import { useUiStore } from '@stores/uiStore'

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
