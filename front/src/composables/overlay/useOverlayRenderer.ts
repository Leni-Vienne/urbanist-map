// AI : Handles rendering of overlays and markers based on mode state
// AI : Single responsibility: converting overlay data into visible map elements

import type { OverlayData } from '@types'
import type { RenderStrategy } from './useOverlayModeStateMachine'
import { map } from '@composables/core/useMap'
import { renderViewModeOverlays, updateOverlayEditingState, clearAllOverlays, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay'
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays'
import { applyPositionsToOverlays } from './useOverlayPositionCache'
import { useStores } from '@composables/core/useStores'
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters'

/**
 * AI : Render overlays based on the current render strategy
 */
export function renderForStrategy(
  strategy: RenderStrategy,
  overlaysData: OverlayData[],
  cityId: string,
  cityName: string
): void {
  const { overlay } = useStores()

  // AI : Apply completion filters
  const completionFilters = useCompletionFilters()
  const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData)

  if (strategy.shouldRenderFullOverlays) {
    // AI : Check if overlays are already loaded - if so, just update positions
    const hasExistingOverlays = Object.keys(overlay.store.overlays).length > 0

    if (!hasExistingOverlays) {
      // AI : First time loading - clear and render fresh
      clearAllOverlays()
      overlay.setViewModeOverlays(visibleOverlays)
      renderViewModeOverlays(visibleOverlays, strategy.shouldRenderMarkers, false)
    }

    // AI : Apply correct positions (cached for edit mode, backend for view mode)
    // AI : applyPosition now guards against overlays not on map yet
    const overlayObjects = Object.values(overlay.store.overlays)
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
    renderOverlayMarkersFromCache(cityId, cityName)
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
  const { overlay } = useStores()
  const overlayObjects = Object.values(overlay.store.overlays)

  // AI : Update positions if needed
  applyPositionsToOverlays(overlayObjects, strategy.shouldUseCachedPositions)

  // AI : Update markers
  overlayObjects.forEach(overlayObject => {
    if (overlayObject.marker) {
      updateMarkerTooltip(overlayObject)
      updateMarkerPosition(overlayObject)
    }

    // AI : Ensure overlays are on the map if they should be visible
    if (overlayObject.overlay && map.value) {
      if (strategy.shouldRenderFullOverlays && !map.value.hasLayer(overlayObject.overlay)) {
        overlayObject.overlay.addTo(map.value)
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
  const { overlay } = useStores()
  overlay.clearViewModeOverlays()
}
