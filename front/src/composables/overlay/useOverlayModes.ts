// AI : Overlay mode management - orchestrates edit/view mode switching using state machine
import { ref, watch } from 'vue'
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { getSelectedCity, hasCachedCityProjectsData, getCachedCityProjectsData } from '@composables/map/useCityData'
import type { OverlayModeState, ZoomLevel, StateTransition } from './useOverlayModeStateMachine'
import {
  calculateTransition,
  shouldFullRerender,
  shouldCachePositions
} from './useOverlayModeStateMachine'
import { renderForStrategy, updateExistingOverlays, clearAllRenderedContent } from './useOverlayRenderer'
import { cacheCurrentPosition } from './useOverlayPositionCache'

// AI : Transition effects - callbacks executed during state transitions
interface TransitionEffects {
  beforeTransition?: (from: OverlayModeState, to: OverlayModeState) => void
  afterTransition?: (to: OverlayModeState) => void
}

// AI : Constants
const MIN_ZOOM_FOR_OVERLAYS = 12

// AI : Current state of the overlay system
const currentState = ref<OverlayModeState>({
  mode: 'view',
  zoomLevel: 'low',
  hasLoadedOverlays: false,
  selectedCityId: null,
})

/**
 * AI : Convert numeric zoom to zoom level category
 */
function getZoomLevel(zoom: number): ZoomLevel {
  return zoom >= MIN_ZOOM_FOR_OVERLAYS ? 'high' : 'low'
}

/**
 * AI : Get current state based on runtime values
 */
function getCurrentState(): OverlayModeState {
  const overlayStore = useOverlayStore()
  const selectedCity = getSelectedCity()
  const zoom = map.value?.getZoom() ?? 0

  return {
    mode: overlayStore.isEditMode ? 'edit' : 'view',
    zoomLevel: getZoomLevel(zoom),
    hasLoadedOverlays: Object.keys(overlayStore.overlays).length > 0,
    selectedCityId: selectedCity?.id ?? null,
  }
}

/**
 * AI : Execute a state transition with optional side effects
 */
function transitionToState(newState: OverlayModeState, effects?: TransitionEffects): void {
  const transition = calculateTransition(currentState.value, newState)

  // AI : Execute before-transition effects
  effects?.beforeTransition?.(currentState.value, newState)

  // AI : Determine if we need full re-render or just updates
  if (shouldFullRerender(transition)) {
    performFullRender(newState, transition)
  } else {
    performPartialUpdate(newState, transition)
  }

  // AI : Update current state
  currentState.value = newState

  // AI : Execute after-transition effects
  effects?.afterTransition?.(newState)
}

/**
 * AI : Perform full re-render with new state
 */
function performFullRender(newState: OverlayModeState, transition: StateTransition): void {
  const selectedCity = getSelectedCity()

  if (!selectedCity || !newState.selectedCityId) {
    clearAllRenderedContent()
    return
  }

  // AI : Get overlays data for the city
  if (hasCachedCityProjectsData(newState.selectedCityId)) {
    const overlaysData = getCachedCityProjectsData(newState.selectedCityId)!
    renderForStrategy(
      transition.renderStrategy,
      overlaysData,
      newState.selectedCityId,
    )
  }
}

/**
 * AI : Perform partial update (positions/controls only)
 */
function performPartialUpdate(newState: OverlayModeState, transition: StateTransition): void {
  updateExistingOverlays(transition.renderStrategy)
}

// ================================
// PUBLIC API
// ================================

/**
 * AI : Toggle between edit and view modes
 */
export function toggleEditMode(onModeExit?: () => void): void {
  const overlayStore = useOverlayStore()

  // AI : Toggle mode in store
  overlayStore.isEditMode = !overlayStore.isEditMode

  // AI : Calculate new state
  const newState = getCurrentState()

  // AI : Execute state transition with side effects
  transitionToState(newState, {
    beforeTransition: (from, to) => {
      // AI : Cache positions when leaving edit mode (using predicate)
      if (shouldCachePositions(from, to)) {
        Object.values(overlayStore.overlays).forEach(cacheCurrentPosition)
      }
    },
    afterTransition: () => {
      // AI : Execute custom exit logic if provided (used by useAddOverlay and MapControls)
      if (!overlayStore.isEditMode && onModeExit) {
        onModeExit()
      }
    }
  })
}

/**
 * AI : Handle edit mode exit - reset overlays to backend positions
 */
export function handleEditModeExit(): void {
  const overlayStore = useOverlayStore()
  const newState = getCurrentState()
  newState.mode = 'view'

  // AI : Transition with caching side effect
  transitionToState(newState, {
    beforeTransition: (from, to) => {
      // AI : Cache positions when leaving edit mode (using predicate)
      if (shouldCachePositions(from, to)) {
        Object.values(overlayStore.overlays).forEach(cacheCurrentPosition)
      }
    }
  })
}

/**
 * AI : Watch for zoom level changes and update state
 */
function watchZoomLevel(): void {
  watch(currentZoomLevel, (newZoom) => {
    const newState = getCurrentState()
    newState.zoomLevel = getZoomLevel(newZoom)

    // AI : Only transition if zoom level actually changed categories
    if (newState.zoomLevel !== currentState.value.zoomLevel) {
      transitionToState(newState)
    }
  })
}

// AI : Initialize watch when map is ready
onMapInitialized(() => {
  watchZoomLevel()

  // AI : Set initial state
  currentState.value = getCurrentState()
})
