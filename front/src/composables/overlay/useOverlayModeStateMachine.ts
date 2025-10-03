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
  const { mode, zoomLevel, hasLoadedOverlays } = state

  // AI : State 1: View mode + High zoom + Has overlays
  if (mode === 'view' && zoomLevel === 'high' && hasLoadedOverlays) {
    return {
      shouldRenderFullOverlays: true,
      shouldRenderMarkers: true,
      shouldShowEditControls: false,
      shouldUseEditColors: false,
      shouldShowTooltips: false,
      shouldUseCachedPositions: false, // Use backend positions
    }
  }

  // AI : State 2: View mode + Low zoom
  if (mode === 'view' && zoomLevel === 'low') {
    return {
      shouldRenderFullOverlays: false,
      shouldRenderMarkers: true,
      shouldShowEditControls: false,
      shouldUseEditColors: false,
      shouldShowTooltips: false,
      shouldUseCachedPositions: false,
    }
  }

  // AI : State 3: Edit mode + High zoom + Has overlays
  if (mode === 'edit' && zoomLevel === 'high' && hasLoadedOverlays) {
    return {
      shouldRenderFullOverlays: true,
      shouldRenderMarkers: true,
      shouldShowEditControls: true,
      shouldUseEditColors: true,
      shouldShowTooltips: true,
      shouldUseCachedPositions: true, // Use cached/modified positions
    }
  }

  // AI : State 4: Edit mode + Low zoom
  if (mode === 'edit' && zoomLevel === 'low') {
    return {
      shouldRenderFullOverlays: false,
      shouldRenderMarkers: true,
      shouldShowEditControls: false,
      shouldUseEditColors: true,
      shouldShowTooltips: true,
      shouldUseCachedPositions: true,
    }
  }

  // AI : Default fallback - view mode behavior
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

  // AI : Full re-render needed if mode changed
  if (from.mode !== to.mode) {
    return true
  }

  // AI : Full re-render needed if zoom level changed significantly
  if (from.zoomLevel !== to.zoomLevel) {
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
