<template>
  <Transition name="help-fade">
    <button
      v-if="actuallyVisible"
      type="button"
      class="help-button"
      @click="handleClick"
    >
      <i class="pi pi-map-marker"></i>
      <span>{{ buttonText }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { map } from '@composables/core/useMap'
import { mobileAwareFlyTo, flyToCountry } from '@composables/map/useMapNavigation'
import { useMapStore } from '@stores/pinia/mapStore'
import { useUiStore } from '@stores/uiStore'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const visible = ref(false)
const mapStore = useMapStore()
const uiStore = useUiStore()
let timeoutId: number | null = null
let observer: MutationObserver | null = null
let checkMarkersDebounceId: number | null = null

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

// AI : Check what markers exist and update button type (debounced)
function checkMarkers() {
  const cityMarkers = document.querySelectorAll('[data-city-id]')
  // AI : Country markers have data-country-code but NOT data-city-id
  const allMarkersWithCountry = document.querySelectorAll('[data-country-code]')
  const countryMarkers = Array.from(allMarkersWithCountry).filter(el => !el.hasAttribute('data-city-id'))

  if (cityMarkers.length > 0 && !mapStore.selectedCity) {
    // AI : City markers exist - show city button after delay
    if (buttonType.value !== 'city') {
      buttonType.value = 'city'
      visible.value = false

      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        if (!mapStore.selectedCity) {
          visible.value = true
        }
      }, 3000)
    }
  } else if (cityMarkers.length === 0 && countryMarkers.length > 0) {
    // AI : Only country markers - set up timeout to show button
    if (buttonType.value !== 'country') {
      buttonType.value = 'country'

      // AI : Start 5-second timeout when we first detect country markers
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        if (buttonType.value === 'country' && !mapStore.selectedCity) {
          visible.value = true
        }
      }, 3000)
    }
  } else {
    // AI : No relevant markers
    visible.value = false
    buttonType.value = null
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }
}

// AI : Debounced version to prevent excessive calls during map interactions
function debouncedCheckMarkers() {
  if (checkMarkersDebounceId) {
    clearTimeout(checkMarkersDebounceId)
  }
  checkMarkersDebounceId = window.setTimeout(() => {
    checkMarkers()
  }, 100) // AI : 100ms debounce
}

// AI : Handle button click - find nearest marker and fly to it
function handleClick() {
  if (!map.value || !buttonType.value) return

  let markers: Element[]
  if (buttonType.value === 'country') {
    // AI : Country markers have data-country-code but NOT data-city-id
    const allMarkersWithCountry = document.querySelectorAll('[data-country-code]')
    markers = Array.from(allMarkersWithCountry).filter(el => !el.hasAttribute('data-city-id'))
  } else {
    markers = Array.from(document.querySelectorAll('[data-city-id]'))
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
      Math.pow(center.lat - lat, 2) + Math.pow(center.lng - lng, 2)
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
      if (countryCode) {
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

.help-fade-enter-active,
.help-fade-leave-active {
  transition: none;
}

.help-fade-enter-from,
.help-fade-leave-to {
  opacity: 0;
}
</style>
