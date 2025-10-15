import L from 'leaflet'
import type { FitBoundsOptions, ZoomPanOptions } from 'leaflet'
import { map } from '@composables/core/useMap'

/**
 * AI : Check if current viewport is mobile size
 */
function isMobile(): boolean {
  return window.innerWidth <= 768
}

/**
 * AI : Calculate latitude offset to account for mobile drawer
 * AI : Returns the adjusted latitude that will appear centered above the drawer
 */
function calculateMobileLatOffset(targetLat: number): number {
  if (!map.value || !isMobile()) return targetLat

  // AI : Calculate pixel offset for drawer (45% of viewport height)
  const drawerOffsetPixels = window.innerHeight * 0.225 // AI : Half of 45% to shift center up
  const mapCenter = map.value.getCenter()
  const centerPoint = map.value.latLngToContainerPoint(mapCenter)
  const offsetPoint = L.point(centerPoint.x, centerPoint.y - drawerOffsetPixels)
  const offsetLatLng = map.value.containerPointToLatLng(offsetPoint)
  
  // AI : Calculate lat offset from center
  return targetLat + (offsetLatLng.lat - mapCenter.lat)
}

/**
 * AI : Mobile-aware flyTo - adjusts center on mobile to account for drawer
 */
export function mobileAwareFlyTo(
  latlng: L.LatLngExpression,
  zoom?: number,
  options?: ZoomPanOptions
): void {
  if (!map.value) return

  const latLng = L.latLng(latlng)
  const targetLat = calculateMobileLatOffset(latLng.lat)
  
  map.value.flyTo([targetLat, latLng.lng], zoom, options)
}

/**
 * AI : Mobile-aware flyToBounds - uses asymmetric padding on mobile
 */
export function mobileAwareFlyToBounds(
  bounds: L.LatLngBoundsExpression,
  options?: FitBoundsOptions
): void {
  if (!map.value) return

  const mobile = isMobile()
  const flyOptions: FitBoundsOptions = mobile
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
