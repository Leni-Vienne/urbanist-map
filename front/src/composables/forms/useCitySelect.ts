import { ref, computed } from 'vue'
import { trpc, RouterOutput } from '@client'
import { getCameraBounds } from '@composables/map/useMapNavigation'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useProjectStore } from '@stores/pinia/projectStore'
import { storeToRefs } from 'pinia'
import type { Project } from '@types'

// AI : Helper function to convert DBCity to city select format
function convertDBCityToSelectFormat(dbCity: Project['city']): RouterOutput['cities']['getCitiesNearLocation'][number] {
  if (!dbCity) throw new Error('City is required')
  return {
    id: dbCity.id,
    name: dbCity.name,
    countryCode: dbCity.countryCode,
    lat: dbCity.coordinates.y,
    lng: dbCity.coordinates.x,
    distance: 0
  }
}

// AI : Get reference location for city search - prioritizes overlay > camera
function getReferenceLocation(): { lat: number; lng: number } | null {
  const overlayStore = useOverlayStore()
  const { idSelectedOverlay, overlays } = storeToRefs(overlayStore)

  // AI : First priority: overlay center if one is selected (for overlay projects)
  if (idSelectedOverlay.value && overlays.value[idSelectedOverlay.value]) {
    const overlayObject = overlays.value[idSelectedOverlay.value]

    if (overlayObject.overlay) {
      try {
        const bounds = overlayObject.overlay.getBounds()
        const center = bounds.getCenter()
        return {
          lat: center.lat,
          lng: center.lng
        }
      } catch (error) {
        console.error('Error getting overlay center:', error)
      }
    }
  }

  // AI : Second priority: camera center as fallback
  const cameraBounds = getCameraBounds()

  if (cameraBounds.value &&
    cameraBounds.value.north !== 0 &&
    cameraBounds.value.south !== 0 &&
    cameraBounds.value.east !== 0 &&
    cameraBounds.value.west !== 0) {
    const center = {
      lat: (cameraBounds.value.north + cameraBounds.value.south) / 2,
      lng: (cameraBounds.value.east + cameraBounds.value.west) / 2
    }
    return center
  }

  return null
}

export function useCitySelect(prefilledCity?: Project['city'], markerCoordinates?: { lat: number; lng: number } | null) {
  const projectStore = useProjectStore()

  // AI : Cities data and state - prefill with existing city if available
  const cities = ref<RouterOutput['cities']['getCitiesNearLocation']>(
    prefilledCity ? [convertDBCityToSelectFormat(prefilledCity)] : []
  )
  const citiesLoading = ref(false)
  const citiesLoaded = ref(!!prefilledCity)

  // AI : Cache the prefilled city if available
  if (prefilledCity) {
    projectStore.cacheCityName(prefilledCity.id, prefilledCity.name)
  }

  // AI : Computed property for cities with display names
  const filteredCities = computed(() => {
    return cities.value.map(city => ({
      ...city,
      displayName: `${city.name}, ${city.countryCode}`
    }))
  })

  // AI : Load cities near a specific location
  async function loadCitiesNearLocation(lat: number, lng: number) {
    try {
      citiesLoading.value = true
      citiesLoaded.value = true

      const nearbyCities = await trpc.cities.getCitiesNearLocation.query({
        lat,
        lng,
        limit: 20
      })

      // AI : Cache all loaded cities
      nearbyCities.forEach(city => {
        projectStore.cacheCityName(city.id, city.name)
      })

      // AI : Merge with prefilled city if it exists and isn't already in the results
      if (prefilledCity) {
        const prefilledCityId = prefilledCity.id
        const cityAlreadyInResults = nearbyCities.some(c => c.id === prefilledCityId)

        if (!cityAlreadyInResults) {
          cities.value = [
            convertDBCityToSelectFormat(prefilledCity),
            ...nearbyCities
          ]
        } else {
          cities.value = nearbyCities
        }
      } else {
        cities.value = nearbyCities
      }
    } catch (error) {
      console.error('Error loading cities near location:', error)
      cities.value = []
    } finally {
      citiesLoading.value = false
    }
  }

  // AI : Load cities when dropdown is about to show
  async function onSelectShow() {
    if (!citiesLoading.value) {
      // AI : Use marker coordinates if available (development projects), otherwise get reference location
      const referenceLocation = markerCoordinates ?? getReferenceLocation()
      if (referenceLocation) {
        await loadCitiesNearLocation(referenceLocation.lat, referenceLocation.lng)
      }
    }
  }

  // AI : Get city name by ID for change indicator
  function getCityName(cityId: string | undefined): string {
    if (!cityId) return 'Not set'
    const city = cities.value.find(c => c.id === cityId)
    return city ? `${city.name}, ${city.countryCode}` : cityId
  }

  return {
    cities,
    citiesLoading,
    citiesLoaded,
    filteredCities,
    onSelectShow,
    loadCitiesNearLocation,
    getCityName
  }
}
