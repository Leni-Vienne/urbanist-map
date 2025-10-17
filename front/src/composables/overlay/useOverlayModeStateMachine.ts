// AI : State machine for overlay mode management
// AI : Defines all possible states and transitions for edit/view modes with zoom levels

export type OverlayMode = 'view' | 'edit'
export type ZoomLevel = 'high' | 'low'

// AI : Explicit transition types for clarity and type safety
export type TransitionType =
  | 'toggleMode'           // AI : Switch between edit and view mode
  | 'zoomIn'              // AI : Zoom level increased to high
  | 'zoomOut'             // AI : Zoom level decreased to low
  | 'changeCity'          // AI : Selected city changed
  | 'loadOverlays'        // AI : Overlays loaded for first time
  | 'clearOverlays'       // AI : Clear all overlays

// AI : Represents the complete state of the overlay system
export interface OverlayModeState {
  mode: OverlayMode
  zoomLevel: ZoomLevel
  hasLoadedOverlays: boolean
  selectedCityId: string | null
}

// AI : Define what should be rendered in each state
export interface RenderStrategy {
  shouldRenderFullOverlays: boolean
  shouldRenderMarkers: boolean
  shouldShowEditControls: boolean
  shouldUseEditColors: boolean
  shouldShowTooltips: boolean
  shouldUseCachedPositions: boolean
}

// AI : State machine configuration - defines behavior for each state combination
export function getRenderStrategy(state: OverlayModeState): RenderStrategy {
  const { mode, zoomLevel } = state

  // AI : High zoom states - should render full overlays
  if (zoomLevel === 'high') {
    if (mode === 'view') {
      return {
        shouldRenderFullOverlays: true,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false,
        shouldShowTooltips: false,
        shouldUseCachedPositions: false, // Use backend positions
      }
    } else {
      // Edit mode
      return {
        shouldRenderFullOverlays: true,
        shouldRenderMarkers: true,
        shouldShowEditControls: true,
        shouldUseEditColors: true,
        shouldShowTooltips: true,
        shouldUseCachedPositions: true, // Use cached/modified positions
      }
    }
  }

  // AI : Low zoom states - markers only
  if (zoomLevel === 'low') {
    if (mode === 'view') {
      return {
        shouldRenderFullOverlays: false,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false,
        shouldShowTooltips: false,
        shouldUseCachedPositions: false,
      }
    } else {
      // Edit mode
      return {
        shouldRenderFullOverlays: false,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: true,
        shouldShowTooltips: true,
        shouldUseCachedPositions: true,
      }
    }
  }

  // AI : Default fallback - should never reach here
  return {
    shouldRenderFullOverlays: false,
    shouldRenderMarkers: true,
    shouldShowEditControls: false,
    shouldUseEditColors: false,
    shouldShowTooltips: false,
    shouldUseCachedPositions: false,
  }
}

// AI : Describes a state transition
export interface StateTransition {
  from: OverlayModeState
  to: OverlayModeState
  renderStrategy: RenderStrategy
}

// AI : Calculate what needs to change when transitioning states
export function calculateTransition(
  from: OverlayModeState,
  to: OverlayModeState
): StateTransition {
  return {
    from,
    to,
    renderStrategy: getRenderStrategy(to),
  }
}

// AI : Helper to determine if overlays need to be reloaded
export function shouldReloadOverlays(transition: StateTransition): boolean {
  const { from, to } = transition

  // AI : Reload if city changed
  if (from.selectedCityId !== to.selectedCityId) {
    return true
  }

  // AI : Reload if transitioning from low to high zoom
  if (from.zoomLevel === 'low' && to.zoomLevel === 'high') {
    return true
  }

  return false
}

// AI : Helper to determine if full re-render is needed
export function shouldFullRerender(transition: StateTransition): boolean {
  const { from, to } = transition

  // AI : City changed - always need full re-render
  if (from.selectedCityId !== to.selectedCityId) {
    return true
  }

  // AI : Zoom level changed - need full re-render to add/remove overlays
  if (from.zoomLevel !== to.zoomLevel) {
    return true
  }

  // AI : Mode changed with overlays loaded - need full re-render to pick up new data
  // AI : Fresh data may have different hasPendingChanges flags and other metadata
  if (from.mode !== to.mode && from.hasLoadedOverlays && to.hasLoadedOverlays && to.zoomLevel === 'high') {
    return true
  }

  // AI : Mode changed without loaded overlays - need full re-render
  if (from.mode !== to.mode) {
    return true
  }

  return false
}

// ================================
// AI : Transition Predicates - Pure functions to check state changes
// ================================

/**
 * AI : Check if we should cache overlay positions
 * AI : This happens when leaving edit mode (transitioning to view mode)
 */
export function shouldCachePositions(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode === 'edit' && to.mode === 'view'
}

/**
 * AI : Check if we should apply cached overlay positions
 * AI : This happens when entering edit mode from view mode
 */
export function shouldApplyCachedPositions(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode === 'view' && to.mode === 'edit' && from.hasLoadedOverlays
}

/**
 * AI : Check if mode is changing (edit ↔ view)
 */
export function isModeChanging(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode !== to.mode
}

/**
 * AI : Check if zoom level is changing (high ↔ low)
 */
export function isZoomChanging(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.zoomLevel !== to.zoomLevel
}

/**
 * AI : Check if selected city is changing
 */
export function isCityChanging(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.selectedCityId !== to.selectedCityId
}

/**
 * AI : Check if switching to edit mode (from any state)
 */
export function isSwitchingToEditMode(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode === 'view' && to.mode === 'edit'
}

/**
 * AI : Check if switching to view mode (from any state)
 */
export function isSwitchingToViewMode(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode === 'edit' && to.mode === 'view'
}
