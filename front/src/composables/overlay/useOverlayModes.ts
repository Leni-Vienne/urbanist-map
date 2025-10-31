// AI : Overlay mode management - orchestrates edit/view mode switching using state machine
import { ref, watch, toRef } from 'vue'
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { getSelectedCity, hasCachedCityProjectsData, getCachedCityProjectsData } from '@composables/map/useCityData'
import type { OverlayModeState, ZoomLevel, StateTransition } from './useOverlayModeStateMachine'
import {
  calculateTransition,
  shouldFullRerender,
  shouldCachePositions
} from './useOverlayModeStateMachine'
import { renderForStrategy, updateExistingOverlays, clearAllRenderedContent } from './useOverlayRenderer'
import { cacheCurrentPosition } from './useOverlayPositionManagement'
import { loadCityOverlays, fetchCityProjectsData } from '@composables/map/useCityOverlays'
import { loadCityDevelopmentProjects, removeCityMarkers, addCityMarkersForCountry, updateAllDevelopmentMarkerColors } from '@composables/map/useCityMarkers'
import { loadCountriesWithProjects, loadCitiesForCountry, addCountryMarkersToMap } from '@composables/map/useCountryMarkers'
import { useProjectStore } from '@stores/pinia/projectStore'
import { updateOverlayMarkersColors } from '@composables/map/useMarkers'
import { updateOverlayEditingState } from '@composables/overlay/useOverlay'
import { storeToRefs } from 'pinia'
import { MAP_CONFIG } from '@constants/mapConstants'

// AI : Transition effects - callbacks executed during state transitions
interface TransitionEffects {
  beforeTransition?: (from: OverlayModeState, to: OverlayModeState) => void
  afterTransition?: (to: OverlayModeState) => void | Promise<void>
}

// AI : Constants
const MIN_ZOOM_FOR_OVERLAYS = MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS

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
    mode: overlayStore.mode,
    zoomLevel: getZoomLevel(zoom),
    hasLoadedOverlays: Object.keys(overlayStore.overlays).length > 0,
    selectedCityId: selectedCity?.id ?? null,
  }
}

/**
 * AI : Execute a state transition with optional side effects
 */
async function transitionToState(newState: OverlayModeState, effects?: TransitionEffects) {
  const transition = calculateTransition(currentState.value, newState)

  // AI : Execute before-transition effects
  effects?.beforeTransition?.(currentState.value, newState)

  // AI : Determine if we need full re-render or just updates
  if (shouldFullRerender(transition)) {
    performFullRender(newState, transition)
  } else {
    performPartialUpdate(transition)
  }

  // AI : Update current state
  currentState.value = newState

  // AI : Execute after-transition effects (fire-and-forget for async effects)
  await effects?.afterTransition?.(newState)
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

  // AI : Get overlays data for the city from mode-aware cache
  if (hasCachedCityProjectsData(newState.selectedCityId, newState.mode)) {
    const overlaysData = getCachedCityProjectsData(newState.selectedCityId, newState.mode)!

    renderForStrategy(
      transition.renderStrategy,
      overlaysData,
      newState.selectedCityId,
    )
  }
}

/**
 * AI : Perform partial update (positions/controls only)
 * AI : Used when state changes don't require full re-render (e.g., just zoom level change)
 */
function performPartialUpdate(transition: StateTransition): void {
  // AI : Simply update properties of existing overlays (positions, editing state, visibility)
  // AI : This preserves Leaflet instances and their internal state (selection, etc.)
  updateExistingOverlays(transition.renderStrategy)
}

/**
 * AI : Shared logic for reloading cities and updating map markers
 */
async function reloadCitiesAndMarkers(countryCode: string): Promise<void> {
  await loadCitiesForCountry(countryCode)
  
  // AI : Update city markers on the map with the new cities list
  removeCityMarkers()
  const projectStore = useProjectStore()
  const { countries } = storeToRefs(projectStore)
  const currentCountry = countries.value.find(c => c.code === countryCode)
  if (currentCountry && currentCountry.cities.length > 0) {
    addCityMarkersForCountry(currentCountry.cities.map(c => ({ ...c, projectCount: 0 })))
  }
}

/**
 * AI : Shared logic for reloading city data (overlays + development projects)
 */
async function reloadCityData(cityId: string): Promise<void> {
  await Promise.all([
    loadCityOverlays(cityId, false),
    loadCityDevelopmentProjects(cityId)
  ])
}

/**
 * AI : Shared before-transition logic for caching overlay positions
 */
function handleBeforeTransition(from: OverlayModeState, to: OverlayModeState): void {
  // AI : Cache positions when leaving edit mode (using predicate)
  if (shouldCachePositions(from, to)) {
    const overlayStore = useOverlayStore()
    Object.values(overlayStore.overlays).forEach(cacheCurrentPosition)
  }
}

/**
 * AI : Switch to a specific map mode (view/edit/moderation)
 * AI : Handles full state machine transition with smart mode-aware caching
 * AI : Uses cached data if available for target mode, otherwise fetches from backend
 */
export async function switchMode(targetMode: 'view' | 'edit' | 'moderation', onModeExit?: () => void): Promise<void> {
  const overlayStore = useOverlayStore()
  const mapStore = useMapStore()

  // AI : Don't do anything if we're already in the target mode
  if (overlayStore.mode === targetMode) {
    return
  }

  // AI : Set new mode
  overlayStore.setMode(targetMode);

  // AI : Calculate new state
  const newState = getCurrentState()
  const selectedCity = getSelectedCity()

  // AI : NO cache invalidation! Smart caching handles mode-specific data automatically
  // AI : fetchCityProjectsData and loadCityDevelopmentProjects check mode-aware cache first
  // AI : If cached data exists for target mode, uses it instantly (no backend call)
  // AI : If not cached, fetches from backend and caches for future use

  // AI : Fetch data for new mode BEFORE transitioning (uses smart cache)
  if (selectedCity && newState.selectedCityId && newState.hasLoadedOverlays && newState.zoomLevel === 'high') {
    await fetchCityProjectsData(newState.selectedCityId)
    await loadCityDevelopmentProjects(newState.selectedCityId)
  } else if (selectedCity && newState.selectedCityId) {
    await reloadCityData(newState.selectedCityId)
  }

  // AI : Execute state transition with side effects
  await transitionToState(newState, {
    beforeTransition: handleBeforeTransition,
    afterTransition: async () => {
      // AI : Update overlay editing state (toolbar actions, draggability) after mode switch
      updateOverlayEditingState()

      // AI : Update overlay marker colors immediately after mode switch
      updateOverlayMarkersColors(toRef(overlayStore, 'overlays'))

      // AI : Update development marker colors immediately after mode switch
      updateAllDevelopmentMarkerColors()

      await loadCountriesWithProjects()
      addCountryMarkersToMap()

      const countryCode = mapStore.selectedCountryCode
      if (countryCode) {
        await reloadCitiesAndMarkers(countryCode)
      }

      // AI : Call onModeExit when leaving edit mode
      if (targetMode !== 'edit' && onModeExit) {
        onModeExit()
      }
    }
  })
}

/**
 * AI : Toggle between edit and view modes (backward compatibility wrapper)
 * @deprecated Use switchMode() instead for more explicit mode transitions
 */
export async function toggleEditMode(onModeExit?: () => void): Promise<void> {
  const overlayStore = useOverlayStore()
  const targetMode = overlayStore.mode === 'edit' ? 'view' : 'edit'
  await switchMode(targetMode, onModeExit)
}

/**
 * AI : Watch for zoom level changes and update state
 */
async function watchZoomLevel() {
  watch(currentZoomLevel, async (newZoom) => {
    const newState = getCurrentState()
    newState.zoomLevel = getZoomLevel(newZoom)

    // AI : Only transition if zoom level actually changed categories
    if (newState.zoomLevel !== currentState.value.zoomLevel) {
      await transitionToState(newState)
    }
  })
}

// AI : Initialize watch when map is ready
onMapInitialized(() => {
  watchZoomLevel()

  // AI : Set initial state
  currentState.value = getCurrentState()
})
