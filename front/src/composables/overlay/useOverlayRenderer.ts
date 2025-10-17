// AI : Handles rendering of overlays and markers based on mode state
// AI : Single responsibility: converting overlay data into visible map elements

import type { OverlayData } from '@types'
import type { RenderStrategy } from './useOverlayModeStateMachine'
import { map } from '@composables/core/useMap'
import { renderViewModeOverlays, updateOverlayEditingState, clearAllOverlays, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay'
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters } from '@composables/map/useCityOverlays'
import { applyPositionsToOverlays } from './useOverlayPositionCache'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters'
import { calculateCenterFromCorners } from '../../utils/typeFactories'

/**
 * AI : Render overlays based on the current render strategy
 */
export function renderForStrategy(
  strategy: RenderStrategy,
  overlaysData: OverlayData[],
  cityId: string,
): void {
  const overlayStore = useOverlayStore()
  const mapStore = useMapStore()

  // AI : Apply completion filters
  const completionFilters = useCompletionFilters()
  const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData)

  if (strategy.shouldRenderFullOverlays) {
    const hasOverlays = Object.keys(overlayStore.overlays).length > 0

    if (!hasOverlays) {
      // AI : First load - render everything
      clearAllOverlays()
      overlayStore.setViewModeOverlays(visibleOverlays)
      renderViewModeOverlays(visibleOverlays, strategy.shouldRenderMarkers, false)
    } else {
      // AI : Smart update - only recreate overlays that changed
      const existingIds = new Set(Object.keys(overlayStore.overlays))
      const newDataMap = new Map(visibleOverlays.map(o => [o.id, o]))

      // AI : Find overlays that need to be recreated (data changed)
      const overlaysToRecreate: OverlayData[] = []
      const overlaysToKeep: string[] = []

      existingIds.forEach(id => {
        const existingOverlay = overlayStore.overlays[id]
        const newData = newDataMap.get(id)

        if (!newData) {
          // AI : Overlay removed from data - will be cleared
          return
        }

        // AI : Update metadata in-place without recreating the overlay instance
        existingOverlay.hasPendingChanges = newData.hasPendingChanges
        existingOverlay.status = newData.status

        // AI : Update the actual Leaflet overlay corners if it exists, then sync the corners property
        if (existingOverlay.overlay) {
          existingOverlay.overlay.setCorners(newData.corners)
          // AI : After setCorners, read back the actual corners from Leaflet to ensure sync
          existingOverlay.corners = existingOverlay.overlay.getCorners()
        } else {
          // AI : No Leaflet overlay loaded, just update the data
          existingOverlay.corners = newData.corners
        }

        // AI : Recalculate centroid from the updated corners
        const newCentroid = calculateCenterFromCorners(existingOverlay.corners)
        if (newCentroid) {
          existingOverlay.centroid = newCentroid
        } else {
          // AI : Fallback to backend centroid if calculation fails
          existingOverlay.centroid = newData.centroid
        }

        overlaysToKeep.push(id)
      })

      // AI : Find new overlays that don't exist yet
      const newOverlays = visibleOverlays.filter(o => !existingIds.has(o.id))

      // AI : Remove overlays that need recreation or are no longer in data
      overlaysToRecreate.forEach(data => {
        const overlay = overlayStore.overlays[data.id]
        if (overlay?.overlay && map.value) {
          map.value.removeLayer(overlay.overlay)
        }
        if (overlay?.marker && map.value) {
          map.value.removeLayer(overlay.marker)
        }
        delete overlayStore.overlays[data.id]
      })

      // AI : Update view mode overlays list
      overlayStore.setViewModeOverlays(visibleOverlays)

      // AI : Render only overlays that need recreation or are new
      const overlaysToRender = [...overlaysToRecreate, ...newOverlays]
      if (overlaysToRender.length > 0) {
        renderViewModeOverlays(overlaysToRender, strategy.shouldRenderMarkers, false)
      }
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

  // AI : CRITICAL: Sync cache data with overlay objects AFTER all updates
  // AI : This ensures markers at low zoom always use updated corners/centroids
  visibleOverlays.forEach(data => {
    const overlayObj = overlayStore.overlays[data.id]
    if (overlayObj) {
      // AI : Sync the data with the updated overlay object
      data.corners = overlayObj.corners
      data.centroid = overlayObj.centroid
      data.hasPendingChanges = overlayObj.hasPendingChanges
      data.status = overlayObj.status
    }
  })

  // AI : Update cache with synced data
  mapStore.setCityProjectsCache(cityId, visibleOverlays)
  overlayStore.setViewModeOverlays(visibleOverlays)
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
