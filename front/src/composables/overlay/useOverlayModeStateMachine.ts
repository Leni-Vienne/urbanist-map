// AI : State machine for overlay mode management
// AI : Defines all possible states and transitions for edit/view/moderation modes with zoom levels

import type { MapMode } from "@shared/types";
export type ZoomLevel = "high" | "low";

// AI : Represents the complete state of the overlay system
export interface OverlayModeState {
  mode: MapMode;
  zoomLevel: ZoomLevel;
  hasLoadedOverlays: boolean;
  selectedCityId: string | null;
}

// AI : Define what should be rendered in each state
export interface RenderStrategy {
  shouldRenderFullOverlays: boolean;
  shouldRenderMarkers: boolean;
  shouldShowEditControls: boolean;
  shouldUseEditColors: boolean;
  shouldShowTooltips: boolean;
  shouldUseCachedPositions: boolean;
}

// AI : State machine configuration - defines behavior for each state combination
export function getRenderStrategy(state: OverlayModeState): RenderStrategy {
  const { mode, zoomLevel } = state;

  // AI : High zoom states - should render full overlays
  if (zoomLevel === "high") {
    if (mode === "view") {
      return {
        shouldRenderFullOverlays: true,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false,
        shouldShowTooltips: false,
        shouldUseCachedPositions: false, // Use backend positions
      };
    } else if (mode === "edit") {
      return {
        shouldRenderFullOverlays: true,
        shouldRenderMarkers: true,
        shouldShowEditControls: true,
        shouldUseEditColors: true,
        shouldShowTooltips: true,
        shouldUseCachedPositions: true, // Use cached/modified positions
      };
    } else {
      // AI : Moderation mode - similar to view but uses objective colors for review
      return {
        shouldRenderFullOverlays: true,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false, // Use objective timeline colors
        shouldShowTooltips: false,
        shouldUseCachedPositions: false, // Use backend positions
      };
    }
  }

  // AI : Low zoom states - markers only
  if (zoomLevel === "low") {
    if (mode === "view") {
      return {
        shouldRenderFullOverlays: false,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false,
        shouldShowTooltips: false,
        shouldUseCachedPositions: false,
      };
    } else if (mode === "edit") {
      return {
        shouldRenderFullOverlays: false,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: true,
        shouldShowTooltips: true,
        shouldUseCachedPositions: true,
      };
    } else {
      // AI : Moderation mode at low zoom - markers with objective colors
      return {
        shouldRenderFullOverlays: false,
        shouldRenderMarkers: true,
        shouldShowEditControls: false,
        shouldUseEditColors: false, // Use objective timeline colors
        shouldShowTooltips: true,
        shouldUseCachedPositions: false,
      };
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
  };
}

// AI : Describes a state transition
export interface StateTransition {
  from: OverlayModeState;
  to: OverlayModeState;
  renderStrategy: RenderStrategy;
}

// AI : Calculate what needs to change when transitioning states
export function calculateTransition(from: OverlayModeState, to: OverlayModeState): StateTransition {
  return {
    from,
    to,
    renderStrategy: getRenderStrategy(to),
  };
}

// AI : Helper to determine if full re-render is needed
export function shouldFullRerender(transition: StateTransition): boolean {
  const { from, to } = transition;

  // AI : City changed - always need full re-render
  if (from.selectedCityId !== to.selectedCityId) {
    return true;
  }

  // AI : Zoom level changed - need full re-render to add/remove overlays
  if (from.zoomLevel !== to.zoomLevel) {
    return true;
  }

  // AI : Mode changed with overlays loaded - need full re-render to pick up new data
  // AI : Fresh data may have different hasPendingChanges flags and other metadata
  if (
    from.mode !== to.mode &&
    from.hasLoadedOverlays &&
    to.hasLoadedOverlays &&
    to.zoomLevel === "high"
  ) {
    return true;
  }

  // AI : Mode changed without loaded overlays - need full re-render
  if (from.mode !== to.mode) {
    return true;
  }

  return false;
}

/**
 * AI : Check if we should cache overlay positions
 * AI : This happens when leaving edit mode (transitioning to view or moderation mode)
 */
export function shouldCachePositions(from: OverlayModeState, to: OverlayModeState): boolean {
  return from.mode === "edit" && (to.mode === "view" || to.mode === "moderation");
}
