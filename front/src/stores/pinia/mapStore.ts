import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { OverlayData } from '@types'

// AI : Type for selected city data (compatible with previous latestClickedCity interface)
export interface SelectedCity {
  id: string
  name: string
  countryCode?: string
}

export const useMapStore = defineStore('map', () => {
  // AI : Currently selected city state (replaces the old latestClickedCity module variable)
  const selectedCity = ref<SelectedCity | null>(null)

  // AI : Current city overlays displayed
  const currentCityOverlays = ref<OverlayData[]>([])

  // AI : City projects cache - moved from module-level to store for proper state management
  const cityProjectsCache = ref<Map<string, OverlayData[]>>(new Map())

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
  function getCityProjectsCache(cityId: string): OverlayData[] | null {
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

  return {
    // State
    selectedCity,
    currentCityOverlays,
    cityProjectsCache,

    // Actions
    setSelectedCity,
    clearSelectedCity,
    hasSelectedCity,
    getCityProjectsCache,
    hasCityProjectsCache,
    setCityProjectsCache,
    clearCityProjectsCache
  }
})
