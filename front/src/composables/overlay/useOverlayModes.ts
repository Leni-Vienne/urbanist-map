// AI : Overlay mode management - orchestrates edit/view mode switching using state machine
import { ref, watch } from 'vue'
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
import { cacheCurrentPosition } from './useOverlayPositionCache'
import { loadCityOverlays, fetchCityProjectsData } from '@composables/map/useCityOverlays'
import { loadCityDevelopmentProjects, removeCityMarkers, addCityMarkersForCountry } from '@composables/map/useCityMarkers'
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers'
import { useProjectStore } from '@stores/pinia/projectStore'
import { storeToRefs } from 'pinia'
import { renderViewModeOverlays } from '@composables/overlay/useOverlay'

// AI : Transition effects - callbacks executed during state transitions
interface TransitionEffects {
  beforeTransition?: (from: OverlayModeState, to: OverlayModeState) => void
  afterTransition?: (to: OverlayModeState) => void | Promise<void>
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

  // AI : Execute after-transition effects (fire-and-forget for async effects)
  void effects?.afterTransition?.(newState)
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
  const overlayStore = useOverlayStore()
  const selectedCity = getSelectedCity()
  
  // AI : Check if there are new overlays that need to be added
  if (selectedCity && newState.selectedCityId && hasCachedCityProjectsData(newState.selectedCityId)) {
    const overlaysData = getCachedCityProjectsData(newState.selectedCityId)!
    const existingOverlayIds = new Set(Object.keys(overlayStore.overlays))
    
    // AI : Find only the new overlays that don't exist yet
    const newOverlays = overlaysData.filter(o => !existingOverlayIds.has(o.id))
    
    if (newOverlays.length > 0) {
      // AI : Add only the new overlays without clearing existing ones
      renderViewModeOverlays(newOverlays, transition.renderStrategy.shouldRenderMarkers, false)
    }
    
    // AI : Update all overlays (existing + newly added) without recreating them
    updateExistingOverlays(transition.renderStrategy)
  } else {
    // AI : No data available, just update existing overlays
    updateExistingOverlays(transition.renderStrategy)
  }
}

/**
 * AI : Shared logic for invalidating cache when switching modes
 */
function invalidateCityCaches(cityId: string): void {
  const mapStore = useMapStore()
  mapStore.clearCityProjectsCache(cityId)
  mapStore.clearCityDevelopmentProjectsCache(cityId)
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
 * AI : Toggle between edit and view modes
 */
export async function toggleEditMode(onModeExit?: () => void): Promise<void> {
  const overlayStore = useOverlayStore()
  const mapStore = useMapStore()

  // AI : Toggle mode in store
  overlayStore.isEditMode = !overlayStore.isEditMode
  
  // AI : Calculate new state
  const newState = getCurrentState()
  const selectedCity = getSelectedCity()

  // AI : Invalidate cache for selected city when switching modes
  // AI : This forces a fresh fetch with the correct viewMode parameter
  if (selectedCity) {
    invalidateCityCaches(selectedCity.id)
  }

  // AI : Fetch new data BEFORE transitioning so it's available for rendering
  if (selectedCity && newState.selectedCityId && newState.hasLoadedOverlays && newState.zoomLevel === 'high') {
    await fetchCityProjectsData(newState.selectedCityId)
    await loadCityDevelopmentProjects(newState.selectedCityId)
  } else if (selectedCity && newState.selectedCityId) {
    await reloadCityData(newState.selectedCityId)
  }

  // AI : Execute state transition with side effects
  transitionToState(newState, {
    beforeTransition: handleBeforeTransition,
    afterTransition: async () => {
      // AI : Reload city list for the country (to show cities with user's pending contributions)
      const countryCode = mapStore.selectedCountryCode
      if (countryCode) {
        await reloadCitiesAndMarkers(countryCode)
      }

      // AI : Execute custom exit logic if provided (used by useAddOverlay and MapControls)
      if (!overlayStore.isEditMode && onModeExit) {
        onModeExit()
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
