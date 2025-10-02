// AI : Overlay mode management - orchestrates edit/view mode switching using state machine
import { ref, watch } from 'vue'
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap'
import { useStores } from '@composables/core/useStores'
import { getSelectedCity, hasCachedCityProjectsData, getCachedCityProjectsData } from '@composables/map/useCityData'
import type { OverlayModeState, ZoomLevel, StateTransition } from './useOverlayModeStateMachine'
import { calculateTransition, shouldFullRerender } from './useOverlayModeStateMachine'
import { renderForStrategy, updateExistingOverlays, clearAllRenderedContent } from './useOverlayRenderer'
import { cacheCurrentPosition } from './useOverlayPositionCache'

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
  const { overlay } = useStores()
  const selectedCity = getSelectedCity()
  const zoom = map.value?.getZoom() ?? 0

  return {
    mode: overlay.store.isEditMode ? 'edit' : 'view',
    zoomLevel: getZoomLevel(zoom),
    hasLoadedOverlays: Object.keys(overlay.store.overlays).length > 0,
    selectedCityId: selectedCity?.id ?? null,
  }
}

/**
 * AI : Execute a state transition
 */
function transitionToState(newState: OverlayModeState): void {
  const transition = calculateTransition(currentState.value, newState)

  // AI : Cache current positions before transitioning out of edit mode
  if (currentState.value.mode === 'edit' && newState.mode === 'view') {
    const { overlay } = useStores()
    Object.values(overlay.store.overlays).forEach(cacheCurrentPosition)
  }

  // AI : Determine if we need full re-render or just updates
  if (shouldFullRerender(transition)) {
    performFullRender(newState, transition)
  } else {
    performPartialUpdate(newState, transition)
  }

  // AI : Update current state
  currentState.value = newState
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
      selectedCity.name
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
  const { overlay } = useStores()

  // AI : Toggle mode in store
  overlay.store.isEditMode = !overlay.store.isEditMode

  // AI : Calculate new state
  const newState = getCurrentState()

  // AI : Execute state transition
  transitionToState(newState)

  // AI : Execute custom exit logic if provided (used by useAddOverlay and MapControls)
  if (!overlay.store.isEditMode && onModeExit) {
    onModeExit()
  }
}

/**
 * AI : Handle edit mode exit - reset overlays to backend positions
 */
export function handleEditModeExit(): void {
  const newState = getCurrentState()
  newState.mode = 'view'
  transitionToState(newState)
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
