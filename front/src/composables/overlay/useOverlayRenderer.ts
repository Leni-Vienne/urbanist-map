// AI : Handles rendering of overlays and markers based on mode state
// AI : Single responsibility: converting overlay data into visible map elements

import type { OverlayData, OverlayObject } from '@types'
import type { RenderStrategy } from './useOverlayModeStateMachine'
import { map } from '@composables/core/useMap'
import { renderViewModeOverlays, updateOverlayEditingState, clearAllOverlays, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay'
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters, removeOverlayMarkers } from '@composables/map/useCityOverlays'
import { applyPositionsToOverlays } from './useOverlayPositionCache'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters'

/**
 * AI : Update markers and editing state for all overlays
 */
function updateMarkersAndEditingState(overlayObjects: OverlayObject[]): void {
  overlayObjects.forEach(overlayObject => {
    if (overlayObject.marker && map.value && !map.value.hasLayer(overlayObject.marker)) {
      overlayObject.marker.addTo(map.value)
    }

    if (overlayObject.marker) {
      updateMarkerPosition(overlayObject)
      updateMarkerTooltip(overlayObject)
    }
  })

  updateOverlayEditingState()
}

/**
 * AI : Render overlays based on the current render strategy
 * AI : Core principle: Update existing overlay instances in-place rather than recreating them
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
    // AI : Remove low-zoom overlay markers layer if it exists
    // AI : This prevents duplicate markers when zooming back in from low zoom
    removeOverlayMarkers()

    // AI : Update store state first (single source of truth)
    overlayStore.setViewModeOverlays(visibleOverlays)

    const existingIds = new Set(Object.keys(overlayStore.overlays))
    const hasExistingOverlays = existingIds.size > 0

    if (!hasExistingOverlays) {
      // AI : No overlays exist yet - initial render (e.g., zooming in from low zoom with markers only)
      renderViewModeOverlays(visibleOverlays, strategy.shouldRenderMarkers, false)

      // AI : Apply positions and update properties for newly rendered overlays
      // AI : Wait for next tick to ensure overlays are on the map before updating positions
      requestAnimationFrame(() => {
        const overlayObjects = Object.values(overlayStore.overlays)
        applyPositionsToOverlays(overlayObjects, strategy.shouldUseCachedPositions)
        updateMarkersAndEditingState(overlayObjects)
      })
    } else {
      // AI : Overlays exist - update them with fresh data
      const newDataMap = new Map(visibleOverlays.map(o => [o.id, o]))

      // AI : Update existing overlay objects with fresh backend data
      existingIds.forEach(id => {
        const existingOverlay = overlayStore.overlays[id]
        const newData = newDataMap.get(id)

        if (!newData) {
          // AI : Overlay removed from backend - will be cleaned up later
          return
        }

        // AI : Update metadata properties from backend
        existingOverlay.hasPendingChanges = newData.hasPendingChanges
        existingOverlay.status = newData.status
        existingOverlay.corners = newData.corners
        existingOverlay.centroid = newData.centroid
      })

      // AI : Find new overlays that need to be created
      const newOverlays = visibleOverlays.filter(o => !existingIds.has(o.id))
      if (newOverlays.length > 0) {
        renderViewModeOverlays(newOverlays, strategy.shouldRenderMarkers, false)
      }

      // AI : Apply positions and update all overlay properties (positions, colors, editing state)
      // AI : For existing overlays, this is safe to do immediately
      const overlayObjects = Object.values(overlayStore.overlays)
      applyPositionsToOverlays(overlayObjects, strategy.shouldUseCachedPositions)
      updateMarkersAndEditingState(overlayObjects)
    }

  } else if (strategy.shouldRenderMarkers) {
    // AI : Low zoom - cache positions, remove markers, clear overlays, render city-wide markers
    const overlayObjects = Object.values(overlayStore.overlays)

    overlayObjects.forEach(overlayObject => {
      // AI : Cache current position BEFORE clearing (critical for edit mode!)
      if (overlayObject.overlay) {
        const corners = overlayObject.overlay.getCorners()
        if (corners?.length === 4) {
          const cornersData = corners.map(c => ({ lat: c.lat, lng: c.lng }))
          overlayStore.saveToEditModeCache(overlayObject.id, {
            corners: cornersData,
            isModified: overlayObject.isModified ?? false
          })
        }
      }

      // AI : Remove individual overlay marker to avoid duplicates with city-wide markers
      if (overlayObject.marker && map.value?.hasLayer(overlayObject.marker)) {
        map.value.removeLayer(overlayObject.marker)
      }
    })

    clearAllOverlays()
    renderOverlayMarkersFromCache(cityId)
  }

  // AI : Update marker colors based on mode
  if (strategy.shouldUseEditColors) {
    updateOverlayMarkersForFilters()
  }

  // AI : Update cache with final state (one-way flow: store → cache)
  mapStore.setCityProjectsCache(cityId, visibleOverlays)
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
