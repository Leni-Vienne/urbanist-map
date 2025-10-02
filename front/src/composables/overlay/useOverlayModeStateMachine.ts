// AI : State machine for overlay mode management
// AI : Defines all possible states and transitions for edit/view modes with zoom levels

export type OverlayMode = 'view' | 'edit'
export type ZoomLevel = 'high' | 'low'

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
