// AI : Handles rendering of overlays and markers based on mode state
// AI : Single responsibility: converting overlay data into visible map elements

import type { OverlayData } from '@types'
import type { RenderStrategy } from './useOverlayModeStateMachine'
import { map } from '@composables/core/useMap'
import { renderViewModeOverlays, updateOverlayEditingState, clearAllOverlays, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay'
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays'
import { applyPositionsToOverlays } from './useOverlayPositionCache'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters'

/**
 * AI : Render overlays based on the current render strategy
 */
export function renderForStrategy(
  strategy: RenderStrategy,
  overlaysData: OverlayData[],
  cityId: string,
): void {
  const overlayStore = useOverlayStore()

  // AI : Apply completion filters
  const completionFilters = useCompletionFilters()
  const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData)

  if (strategy.shouldRenderFullOverlays) {
    // AI : Only clear and recreate if this is first load or overlays don't exist yet
    const hasOverlays = Object.keys(overlayStore.overlays).length > 0
    
    if (!hasOverlays) {
      clearAllOverlays()
      overlayStore.setViewModeOverlays(visibleOverlays)
      renderViewModeOverlays(visibleOverlays, strategy.shouldRenderMarkers, false)
    }

    // AI : Apply correct positions (cached for edit mode, backend for view mode)
    // AI : Must be called after overlays are added to map (after renderViewModeOverlays)
    const overlayObjects = Object.values(overlayStore.overlays)
    applyPositionsToOverlays(overlayObjects, strategy.shouldUseCachedPositions)

    // AI : Update marker tooltips and positions after applying positions
    overlayObjects.forEach(overlayObject => {
      if (overlayObject.marker) {
        updateMarkerPosition(overlayObject)
        updateMarkerTooltip(overlayObject)
      }
    })

    // AI : Update editing state (enable/disable controls)
    updateOverlayEditingState()

  } else if (strategy.shouldRenderMarkers) {
    // AI : Clear full overlays and render markers only (low zoom)
    clearAllOverlays()
    renderOverlayMarkersFromCache(cityId)
  }

  // AI : Update marker colors for edit/view mode
  if (strategy.shouldUseEditColors) {
    updateOverlayMarkersForFilters()
  }
}

/**
 * AI : Update existing overlays without full re-render
 * AI : Used when only editing state or positions need to change
 */
export function updateExistingOverlays(strategy: RenderStrategy): void {
  const overlayStore = useOverlayStore()
  const overlayObjects = Object.values(overlayStore.overlays)

  // AI : Update positions if needed
  applyPositionsToOverlays(overlayObjects, strategy.shouldUseCachedPositions)

  // AI : Update markers
  overlayObjects.forEach(overlayObject => {
    if (overlayObject.marker) {
      updateMarkerTooltip(overlayObject)
      updateMarkerPosition(overlayObject)
    }

    // AI : Manage overlay visibility based on zoom level
    if (overlayObject.overlay && map.value) {
      if (strategy.shouldRenderFullOverlays && !map.value.hasLayer(overlayObject.overlay)) {
        // AI : Add overlay to map if zoom is high enough
        overlayObject.overlay.addTo(map.value)
      } else if (!strategy.shouldRenderFullOverlays && map.value.hasLayer(overlayObject.overlay)) {
        // AI : Remove overlay from map if zoom is too low (but keep in store)
        map.value.removeLayer(overlayObject.overlay)
      }
    }
  })

  // AI : Update editing controls
  updateOverlayEditingState()

  // AI : Update marker colors
  if (strategy.shouldUseEditColors) {
    updateOverlayMarkersForFilters()
  }
}

/**
 * AI : Clear all overlays and markers from the map
 */
export function clearAllRenderedContent(): void {
  clearAllOverlays()
  const overlayStore = useOverlayStore()
  overlayStore.clearViewModeOverlays()
}
