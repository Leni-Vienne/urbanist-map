<template>
  <Transition name="help-fade">
    <button v-if="actuallyVisible" type="button" class="help-button" @click="handleClick">
      <i class="pi pi-map-marker"></i>
      <span>{{ buttonText }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { map } from '@/composables/core/useMap'
import { mobileAwareFlyTo, flyToCountry } from '@/composables/map/useMapNavigation'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useUiStore } from '@/stores/uiStore'
import { useI18n } from 'vue-i18n'
import countryBboxes from '@/assets/country_bboxes.json'

// AI : Type guard to validate country code against countryBboxes keys
function isValidCountryCode(code: string): code is keyof typeof countryBboxes {
  return code in countryBboxes
}

const { t } = useI18n()
const visible = ref(false)
const mapStore = useMapStore()
const uiStore = useUiStore()
let timeoutId: ReturnType<typeof setTimeout> | null = null
let observer: MutationObserver | null = null
let checkMarkersDebounceId: ReturnType<typeof setTimeout> | null = null

// AI : Determine which type of button to show: 'country' or 'city'
const buttonType = ref<'country' | 'city' | null>(null)

// AI : Computed visibility - hide when marker placement bar is visible
const actuallyVisible = computed(() => {
  return visible.value && !uiStore.markerPlacementBarVisible
})

const buttonText = computed(() => {
  return buttonType.value === 'country'
    ? t('map.clickCountryMarker')
    : t('map.clickCityMarker')
})

// AI : Hide button when user selects a city
watch(() => mapStore.selectedCity, (city) => {
  if (city) {
    visible.value = false
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }
})

// AI : Query DOM for city and country markers
function getMarkersFromDOM() {
  const cityMarkers = document.querySelectorAll('[data-city-id]')
  // AI : Country markers have data-country-code but NOT data-city-id
  const allMarkersWithCountry = document.querySelectorAll('[data-country-code]')
  const countryMarkers = [...allMarkersWithCountry].filter(el => !el.hasAttribute('data-city-id'))

  return { cityMarkers, countryMarkers }
}

// AI : Show button after delay if no city is selected
function showButtonWithDelay(type: 'city' | 'country') {
  if (buttonType.value !== type) {
    buttonType.value = type
    visible.value = false

    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = globalThis.setTimeout(() => {
      if (!mapStore.selectedCity && buttonType.value === type) {
        visible.value = true
      }
    }, 3000)
  }
}

// AI : Hide button and reset state
function hideAndResetButton() {
  visible.value = false
  buttonType.value = null
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
}

// AI : Check what markers exist and update button type (debounced)
function checkMarkers() {
  const { cityMarkers, countryMarkers } = getMarkersFromDOM()

  if (cityMarkers.length > 0 && !mapStore.selectedCity) {
    // AI : City markers exist - show city button after delay
    showButtonWithDelay('city')
  } else if (cityMarkers.length === 0 && countryMarkers.length > 0) {
    // AI : Only country markers - show country button after delay
    showButtonWithDelay('country')
  } else {
    // AI : No relevant markers
    hideAndResetButton()
  }
}

// AI : Debounced version to prevent excessive calls during map interactions
function debouncedCheckMarkers() {
  if (checkMarkersDebounceId) {
    clearTimeout(checkMarkersDebounceId)
  }
  checkMarkersDebounceId = globalThis.setTimeout(() => {
    checkMarkers()
  }, 100) // AI : 100ms debounce
}

// AI : Handle button click - find nearest marker and fly to it
function handleClick() {
  if (!map.value || !buttonType.value) return

  let markers: Element[] = []
  if (buttonType.value === 'country') {
    // AI : Country markers have data-country-code but NOT data-city-id
    const allMarkersWithCountry = document.querySelectorAll('[data-country-code]')
    markers = [...allMarkersWithCountry].filter(el => !el.hasAttribute('data-city-id'))
  } else {
    markers = [...document.querySelectorAll('[data-city-id]')]
  }

  if (markers.length === 0) return

  // AI : Find nearest marker
  const center = map.value.getCenter()
  let nearestMarker: HTMLElement | null = null
  let minDistance = Infinity

  markers.forEach((markerElement) => {
    const element = markerElement as HTMLElement
    const lat = parseFloat(element.getAttribute('data-lat') ?? '0')
    const lng = parseFloat(element.getAttribute('data-lng') ?? '0')

    const distance = Math.sqrt(
      (center.lat - lat) ** 2 + (center.lng - lng) ** 2
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestMarker = element
    }
  })

  if (nearestMarker) {
    const markerToClick: HTMLElement = nearestMarker
    const lat = parseFloat(markerToClick.getAttribute('data-lat') ?? '0')
    const lng = parseFloat(markerToClick.getAttribute('data-lng') ?? '0')

    // AI : For country markers, use bounding box if available
    if (buttonType.value === 'country') {
      const countryCode = markerToClick.getAttribute('data-country-code')
      if (countryCode && isValidCountryCode(countryCode)) {
        flyToCountry(countryCode, lat, lng)
      }
    } else {
      mobileAwareFlyTo([lat, lng], 14, {
        duration: 1.5
      })
    }

    setTimeout(() => {
      markerToClick.click()
      visible.value = false
    }, 1600)
  }
}

onMounted(() => {
  // AI : Set up MutationObserver to watch for marker changes
  observer = new MutationObserver(() => {
    debouncedCheckMarkers()
  })

  const mapContainer = document.getElementById('mapDiv')
  if (mapContainer) {
    observer.observe(mapContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-city-id', 'data-country-code']
    })
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
  if (timeoutId) {
    clearTimeout(timeoutId)
  }
  if (checkMarkersDebounceId) {
    clearTimeout(checkMarkersDebounceId)
  }
})
</script>

<style scoped>
.help-button {
  /* AI : Reset button defaults */
  appearance: none;
  font-family: inherit;
  /* AI : Layout and styling */
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);

  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;

  background: var(--p-surface-0);
  color: var(--p-surface-700);
  border: 2px solid var(--p-surface-300);
  border-radius: 9999px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.5);

  font-size: 14px;
  font-weight: 600;

  cursor: pointer;
  z-index: 1000;
}

.help-button:hover {
  color: var(--p-surface-700);
  background: var(--p-surface-200);
  border-color: var(--p-surface-300);
}

.help-button:active {
  transform: translateX(-50%) scale(0.98);
}

.help-button i {
  font-size: 0.875rem;
  color: var(--p-primary-500);
}
</style>
