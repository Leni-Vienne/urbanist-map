<template>
  <Select
    :id="id"
    :modelValue="modelValue"
    :options="filteredCities"
    optionLabel="displayName"
    optionValue="id"
    class="w-full"
    :showClear="false"
    :loading="citiesLoading"
    :disabled="disabled"
    :required="required"
    appendTo="body"
    :pt="{ overlay: { style: 'z-index: 9999 !important' } }"
    @update:modelValue="$emit('update:modelValue', $event)"
    @show="loadCities"
  >
    <template #option="{ option }">
      <div class="flex items-center justify-between w-full">
        <span>{{ option.name }}</span>
        <span class="text-xs text-gray-500">
          {{ option.countryCode }}
          <span v-if="option.distance > 0"> ({{ Math.round(option.distance) / 1000 }} km)</span>
        </span>
      </div>
    </template>
  </Select>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { trpc, type RouterOutput } from '@/client';
import { getCameraBounds } from '@/composables/map/useMapNavigation'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { storeToRefs } from 'pinia'
import type { Project } from '@/types/index'

interface Props {
  modelValue: number | undefined
  id?: number
  prefilledCity?: Project['city']
  markerCoordinates?: { lat: number; lng: number } | null
  disabled?: boolean
  required?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  id: 0,
  disabled: false,
  required: false,
  markerCoordinates: null
})

defineEmits<{
  'update:modelValue': [value: number | undefined]
}>()

const projectStore = useProjectStore()

// AI : Cities data and state
const cities = ref<RouterOutput['cities']['getCitiesNearLocation']>(
  props.prefilledCity ? [convertDBCityToSelectFormat(props.prefilledCity)] : []
)
const citiesLoading = ref(false)
const citiesLoaded = ref(Boolean(props.prefilledCity))

// AI : Cache the prefilled city if available
if (props.prefilledCity) {
  projectStore.cacheCityName(props.prefilledCity.id, props.prefilledCity.name)
}

// AI : Computed property for cities with display names
const filteredCities = computed(() => {
  return cities.value.map(city => ({
    ...city,
    displayName: `${city.name}, ${city.countryCode}`
  }))
})

// AI : Helper function to convert DBCity to city select format
function convertDBCityToSelectFormat(dbCity: Project['city']): RouterOutput['cities']['getCitiesNearLocation'][number] {
  if (!dbCity) throw new Error('City is required')
  return {
    id: dbCity.id,
    name: dbCity.name,
    nameLocal: dbCity.nameLocal,
    countryCode: dbCity.countryCode,
    lat: dbCity.coordinates.y,
    lng: dbCity.coordinates.x,
    distance: 0
  }
}

// AI : Get reference location for city search
function getReferenceLocation(): { lat: number; lng: number } | null {
  const overlayStore = useOverlayStore()
  const { idSelectedOverlay, overlays } = storeToRefs(overlayStore)

  // AI : First priority: overlay center if one is selected
  if (idSelectedOverlay.value && overlays.value[idSelectedOverlay.value]) {
    const overlayObject = overlays.value[idSelectedOverlay.value]
    if (overlayObject.overlay) {
      try {
        const bounds = overlayObject.overlay.getBounds()
        const center = bounds.getCenter()
        return { lat: center.lat, lng: center.lng }
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
    return {
      lat: (cameraBounds.value.north + cameraBounds.value.south) / 2,
      lng: (cameraBounds.value.east + cameraBounds.value.west) / 2
    }
  }

  return null
}

// AI : Load cities when dropdown opens
async function loadCities() {
  if (citiesLoading.value) return

  const referenceLocation = props.markerCoordinates ?? getReferenceLocation()
  if (!referenceLocation) return

  try {
    citiesLoading.value = true
    citiesLoaded.value = true

    const nearbyCities = await trpc.cities.getCitiesNearLocation.query({
      lat: referenceLocation.lat,
      lng: referenceLocation.lng,
      limit: 20
    })

    nearbyCities.forEach(city => {
      projectStore.cacheCityName(city.id, city.name)
    })

    // AI : Merge with prefilled city if not in results
    if (props.prefilledCity) {
      const cityAlreadyInResults = nearbyCities.some(c => c.id === props.prefilledCity!.id)
      if (!cityAlreadyInResults) {
        cities.value = [convertDBCityToSelectFormat(props.prefilledCity), ...nearbyCities]
      } else {
        cities.value = nearbyCities
      }
    } else {
      cities.value = nearbyCities
    }
  } catch (error) {
    console.error('Error loading cities:', error)
    cities.value = []
  } finally {
    citiesLoading.value = false
  }
}

// AI : Get city name by ID
function getCityName(cityId: number | undefined): string {
  if (!cityId) return 'Not set'
  const city = cities.value.find(c => c.id === cityId)
  return city ? `${city.name}, ${city.countryCode}` : String(cityId)
}

defineExpose({
  cities,
  citiesLoaded,
  getCityName
})
</script>
