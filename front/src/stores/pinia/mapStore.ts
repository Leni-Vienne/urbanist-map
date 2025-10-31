import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { OverlayData, MapMode } from '@types'
import type { RouterOutput } from '@client'

// AI : Type for selected city data (compatible with previous latestClickedCity interface)
export interface SelectedCity {
  id: string
  name: string
  countryCode?: string
}

export const useMapStore = defineStore('map', () => {
  // AI : Currently selected city state (replaces the old latestClickedCity module variable)
  const selectedCity = ref<SelectedCity | null>(null)

  // AI : Currently selected country code (set when clicking a country marker)
  const selectedCountryCode = ref<string | null>(null)

  // AI : Current city overlays displayed
  const currentCityOverlays = ref<OverlayData[]>([])

  // AI : City projects cache - mode-aware for smart caching (cityId → mode → data)
  // AI : This allows fast mode switching without backend calls while maintaining data correctness
  const cityProjectsCache = ref<Map<string, Map<MapMode, OverlayData[]>>>(new Map())

  // AI : City development projects cache - mode-aware (cityId → mode → data)
  const cityDevelopmentProjectsCache = ref<Map<string, Map<MapMode, RouterOutput['project']['getCityProjects']>>>(new Map())

  // AI : Set the currently selected city
  function setSelectedCity(city: SelectedCity | null) {
    selectedCity.value = city
  }

  // AI : Clear the selected city
  function clearSelectedCity() {
    selectedCity.value = null
  }

  // AI : Check if a city is currently selected
  function hasSelectedCity() {
    return selectedCity.value !== null
  }

  // AI : City cache management - mode-aware
  function getCityOverlaysAndProjectsCache(cityId: string, mode: MapMode): OverlayData[] | null {
    const cityCache = cityProjectsCache.value.get(cityId)
    if (!cityCache) return null
    return cityCache.get(mode) ?? null
  }

  function hasCityProjectsCache(cityId: string, mode: MapMode): boolean {
    const cityCache = cityProjectsCache.value.get(cityId)
    return cityCache?.has(mode) ?? false
  }

  function setCityProjectsCache(cityId: string, mode: MapMode, data: OverlayData[]) {
    let cityCache = cityProjectsCache.value.get(cityId)
    if (!cityCache) {
      cityCache = new Map()
      cityProjectsCache.value.set(cityId, cityCache)
    }
    cityCache.set(mode, data)
  }

  function clearCityProjectsCache(cityId?: string, mode?: MapMode) {
    if (cityId && mode) {
      // AI : Clear specific mode cache for a city
      const cityCache = cityProjectsCache.value.get(cityId)
      if (cityCache) {
        cityCache.delete(mode)
      }
    } else if (cityId) {
      // AI : Clear all mode caches for a city
      cityProjectsCache.value.delete(cityId)
    } else {
      // AI : Clear entire cache
      cityProjectsCache.value.clear()
    }
  }

  // AI : Development projects cache management - mode-aware
  function getCityDevelopmentProjectsCache(cityId: string, mode: MapMode): RouterOutput['project']['getCityProjects'] | null {
    const cityCache = cityDevelopmentProjectsCache.value.get(cityId)
    if (!cityCache) return null
    return cityCache.get(mode) ?? null
  }

  function hasCityDevelopmentProjectsCache(cityId: string, mode: MapMode): boolean {
    const cityCache = cityDevelopmentProjectsCache.value.get(cityId)
    return cityCache?.has(mode) ?? false
  }

  function setCityDevelopmentProjectsCache(cityId: string, mode: MapMode, data: RouterOutput['project']['getCityProjects']) {
    let cityCache = cityDevelopmentProjectsCache.value.get(cityId)
    if (!cityCache) {
      cityCache = new Map()
      cityDevelopmentProjectsCache.value.set(cityId, cityCache)
    }
    cityCache.set(mode, data)
  }

  function clearCityDevelopmentProjectsCache(cityId?: string, mode?: MapMode) {
    if (cityId && mode) {
      // AI : Clear specific mode cache for a city
      const cityCache = cityDevelopmentProjectsCache.value.get(cityId)
      if (cityCache) {
        cityCache.delete(mode)
      }
    } else if (cityId) {
      // AI : Clear all mode caches for a city
      cityDevelopmentProjectsCache.value.delete(cityId)
    } else {
      // AI : Clear entire cache
      cityDevelopmentProjectsCache.value.clear()
    }
  }

  return {
    // State
    selectedCity,
    selectedCountryCode,
    currentCityOverlays,
    cityProjectsCache,
    cityDevelopmentProjectsCache,

    // Actions
    setSelectedCity,
    clearSelectedCity,
    hasSelectedCity,
    getCityOverlaysAndProjectsCache,
    hasCityProjectsCache,
    setCityProjectsCache,
    clearCityProjectsCache,
    getCityDevelopmentProjectsCache,
    hasCityDevelopmentProjectsCache,
    setCityDevelopmentProjectsCache,
    clearCityDevelopmentProjectsCache
  }
})
