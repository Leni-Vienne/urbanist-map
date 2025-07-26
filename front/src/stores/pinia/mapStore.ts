import { defineStore } from 'pinia'
import { ref } from 'vue'

// AI : Type for selected city data (compatible with previous latestClickedCity interface)
export interface SelectedCity {
  id: string
  name: string
  countryCode?: string
}

export const useMapStore = defineStore('map', () => {
  // AI : Currently selected city state (replaces the old latestClickedCity module variable)
  const selectedCity = ref<SelectedCity | null>(null)

  // AI : Set the currently selected city
  const setSelectedCity = (city: SelectedCity | null) => {
    selectedCity.value = city
  }

  // AI : Clear the selected city
  const clearSelectedCity = () => {
    selectedCity.value = null
  }

  // AI : Check if a city is currently selected
  const hasSelectedCity = () => {
    return selectedCity.value !== null
  }

  return {
    // State
    selectedCity,
    
    // Actions
    setSelectedCity,
    clearSelectedCity,
    hasSelectedCity
  }
})
