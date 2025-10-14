import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { OverlayData } from '@types'
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

  // AI : City projects cache - moved from module-level to store for proper state management
  const cityProjectsCache = ref<Map<string, OverlayData[]>>(new Map())

  // AI : City development projects cache (separate from overlays cache)
  const cityDevelopmentProjectsCache = ref<Map<string, RouterOutput['project']['getCityProjects']>>(new Map())

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

  // AI : City cache management
  function getCityOverlaysAndProjectsCache(cityId: string): OverlayData[] | null {
    return cityProjectsCache.value.get(cityId) ?? null
  }

  function hasCityProjectsCache(cityId: string): boolean {
    return cityProjectsCache.value.has(cityId)
  }

  function setCityProjectsCache(cityId: string, data: OverlayData[]) {
    cityProjectsCache.value.set(cityId, data)
  }

  function clearCityProjectsCache(cityId?: string) {
    if (cityId) {
      cityProjectsCache.value.delete(cityId)
    } else {
      cityProjectsCache.value.clear()
    }
  }

  // AI : Development projects cache management
  function getCityDevelopmentProjectsCache(cityId: string): RouterOutput['project']['getCityProjects'] | null {
    return cityDevelopmentProjectsCache.value.get(cityId) ?? null
  }

  function hasCityDevelopmentProjectsCache(cityId: string): boolean {
    return cityDevelopmentProjectsCache.value.has(cityId)
  }

  function setCityDevelopmentProjectsCache(cityId: string, data: RouterOutput['project']['getCityProjects']) {
    cityDevelopmentProjectsCache.value.set(cityId, data)
  }

  function clearCityDevelopmentProjectsCache(cityId?: string) {
    if (cityId) {
      cityDevelopmentProjectsCache.value.delete(cityId)
    } else {
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
