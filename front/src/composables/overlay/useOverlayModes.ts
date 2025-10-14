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
import { loadCityOverlays } from '@composables/map/useCityOverlays'
import { loadCityDevelopmentProjects, removeCityMarkers, addCityMarkersForCountry } from '@composables/map/useCityMarkers'
import { loadCitiesForCountry } from '@composables/map/useCountryMarkers'
import { useProjectStore } from '@stores/pinia/projectStore'
import { storeToRefs } from 'pinia'

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
  const mapStore = useMapStore()

  // AI : Toggle mode in store
  overlayStore.isEditMode = !overlayStore.isEditMode
  
  // AI : Invalidate cache for selected city when switching modes
  // AI : This forces a fresh fetch with the correct viewMode parameter
  const selectedCity = getSelectedCity()
  if (selectedCity) {
    mapStore.clearCityProjectsCache(selectedCity.id)
    mapStore.clearCityDevelopmentProjectsCache(selectedCity.id)
  }

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
    afterTransition: async () => {
      // AI : Reload cities for the country (cities cache handles viewMode automatically)
      const countryCode = mapStore.selectedCountryCode
      if (countryCode) {
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
      
      // AI : Reload both overlays and development projects with the new viewMode if we have a selected city
      if (selectedCity && newState.selectedCityId) {
        await Promise.all([
          loadCityOverlays(newState.selectedCityId, false),
          loadCityDevelopmentProjects(newState.selectedCityId)
        ])
      }

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
  const mapStore = useMapStore()

  // AI : Invalidate cache for selected city when exiting edit mode
  const selectedCity = getSelectedCity()
  if (selectedCity) {
    mapStore.clearCityProjectsCache(selectedCity.id)
    mapStore.clearCityDevelopmentProjectsCache(selectedCity.id)
  }

  const newState = getCurrentState()
  newState.mode = 'view'

  // AI : Transition with caching side effect
  transitionToState(newState, {
    beforeTransition: (from, to) => {
      // AI : Cache positions when leaving edit mode (using predicate)
      if (shouldCachePositions(from, to)) {
        Object.values(overlayStore.overlays).forEach(cacheCurrentPosition)
      }
    },
    afterTransition: async () => {
      // AI : Reload cities for the country (cities cache handles viewMode automatically)
      const countryCode = mapStore.selectedCountryCode
      if (countryCode) {
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
      
      // AI : Reload both overlays and development projects with viewMode=true after exiting edit mode
      if (selectedCity && newState.selectedCityId) {
        await Promise.all([
          loadCityOverlays(newState.selectedCityId, false),
          loadCityDevelopmentProjects(newState.selectedCityId)
        ])
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
