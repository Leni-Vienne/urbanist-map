// AI : Handles rendering of overlays and markers based on mode state
// AI : Single responsibility: converting overlay data into visible map elements

import type { OverlayData, OverlayObject } from '@types'
import type { RenderStrategy } from './useOverlayModeStateMachine'
import { map } from '@composables/core/useMap'
import { renderViewModeOverlays, updateOverlayEditingState, updateMarkerTooltip, updateMarkerPosition } from '@composables/overlay/useOverlay'
import { clearAllOverlays } from '@composables/overlay/useOverlayLifecycle'
import { renderOverlayMarkersFromCache, updateOverlayMarkersForFilters, removeOverlayMarkers } from '@composables/map/useCityOverlays'
import { applyPositionsToOverlays } from './useOverlayPositionManagement'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters'
import { addDevelopmentMarkerForProject } from '@composables/map/useDevelopmentMarkers'
import { useProjectStore } from '@stores/pinia/projectStore'

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

      // AI : If using cached positions, apply them after render (requires requestAnimationFrame to ensure overlays are on map)
      if (strategy.shouldUseCachedPositions) {
        requestAnimationFrame(() => {
          const overlayObjects = Object.values(overlayStore.overlays)
          applyPositionsToOverlays(overlayObjects, true)
          // AI : Update editing state to reflect cached positions (e.g., isModified flag affects marker color)
          updateOverlayEditingState()
        })
      }
      // AI : For non-cached initial render, overlays already have correct backend positions and markers/tooltips from renderViewModeOverlays
    } else {
      // AI : Overlays exist - update them with fresh data
      const newDataMap = new Map(visibleOverlays.map(o => [o.id, o]))

      // AI : Remove overlays that are no longer visible (e.g., switched from edit to view mode)
      const overlaysToRemove: string[] = []
      existingIds.forEach(id => {
        if (!newDataMap.has(id)) {
          overlaysToRemove.push(id)
        }
      })

      // AI : Track project IDs that had overlays removed to check if they need development markers
      const projectsWithRemovedOverlays = new Set<string>()

      overlaysToRemove.forEach(id => {
        const overlayToRemove = overlayStore.overlays[id]
        if (overlayToRemove) {
          // AI : Track the project ID before removing the overlay
          if (overlayToRemove.projectId) {
            projectsWithRemovedOverlays.add(overlayToRemove.projectId)
          }

          // AI : Clear selection if this overlay was selected
          if (overlayStore.idSelectedOverlay === id) {
            overlayStore.idSelectedOverlay = null
          }

          // AI : Remove from map and destroy Leaflet objects
          if (overlayToRemove.overlay) {
            if (map.value != null && map.value.hasLayer(overlayToRemove.overlay)) {
              map.value.removeLayer(overlayToRemove.overlay)
            }
            // AI : Force remove by calling remove() on the Leaflet object itself
            overlayToRemove.overlay.remove()
          }
          if (overlayToRemove.marker) {
            if (map.value != null && map.value.hasLayer(overlayToRemove.marker)) {
              map.value.removeLayer(overlayToRemove.marker)
            }
            // AI : Force remove marker
            overlayToRemove.marker.remove()
          }
          // AI : Remove from store
          delete overlayStore.overlays[id]
          delete overlayStore.allMarkers[id]
        }
      })

      // AI : Check if any projects now have no visible overlays and need development markers
      // AI : This handles the case where pending overlays are removed when switching to view mode
      if (projectsWithRemovedOverlays.size > 0) {
        const projectStore = useProjectStore()
        const remainingOverlayProjectIds = new Set(
          Object.values(overlayStore.overlays)
            .map(o => o.projectId)
            .filter((id): id is string => id !== null && id !== undefined)
        )

        projectsWithRemovedOverlays.forEach(projectId => {
          // AI : If project has no remaining overlays, add development marker
          if (!remainingOverlayProjectIds.has(projectId)) {
            const project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId]
            if (project && project.lat && project.lng) {
              addDevelopmentMarkerForProject(project)
            }
          }
        })
      }

      // AI : Update existing overlay objects with fresh backend data
      existingIds.forEach(id => {
        const existingOverlay = overlayStore.overlays[id]
        const newData = newDataMap.get(id)

        if (!newData || !existingOverlay) {
          return
        }

        // AI : Update metadata properties from backend
        existingOverlay.hasPendingChanges = newData.hasPendingChanges
        existingOverlay.status = newData.status
        existingOverlay.corners = newData.corners // AI : Always approved position
        existingOverlay.suggestedCorners = newData.suggestedCorners // AI : Suggested position if pending changes exist
        existingOverlay.centroid = newData.centroid
        existingOverlay.isViewingApprovedPosition = undefined // AI : Reset toggle state when receiving fresh data from mode switch
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
      if (overlayObject.marker && map.value != null && map.value.hasLayer(overlayObject.marker)) {
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

  // AI : Update cache with final state for current mode (one-way flow: store → cache)
  mapStore.setCityProjectsCache(cityId, overlayStore.mode, visibleOverlays)
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
