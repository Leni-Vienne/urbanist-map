<template>
  <Transition name="help-fade">
    <button v-if="actuallyVisible" type="button" class="help-button" @click="handleClick">
      <i class="pi pi-map-marker"></i>
      <span>{{ buttonText }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "vue-i18n";
import { citiesWithProjects } from "@/services/map/cityMarkers";

const { t } = useI18n();
const visible = ref(false);
const mapStore = useMapStore();
const uiStore = useUiStore();
let timeoutId: ReturnType<typeof setTimeout> | null = null;

// AI : Computed visibility - hide when marker placement bar is visible
const actuallyVisible = computed(() => {
  return visible.value && !uiStore.markerPlacementBarVisible;
});

const buttonText = computed(() => {
  return t("map.clickCityMarker");
});

// AI : Show button after delay if no city is selected and cities are available
function showButtonWithDelay() {
  // AI : If timeout is already active, don't restart it
  if (timeoutId) return;

  timeoutId = globalThis.setTimeout(() => {
    if (!mapStore.selectedCity && citiesWithProjects.value.length > 0) {
      visible.value = true;
    }
  }, 3000);
}

// AI : Hide button and reset state
function hideButton() {
  visible.value = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

// AI : Check visibility rules based on state
function checkVisibility() {
  if (citiesWithProjects.value.length > 0 && !mapStore.selectedCity) {
    showButtonWithDelay();
  } else {
    hideButton();
  }
}

// AI : Watch for changes in cities or selected city
watch(
  [() => mapStore.selectedCity, () => citiesWithProjects.value.length],
  () => {
    checkVisibility();
  },
  { immediate: true },
);

// AI : Handle button click - find nearest city marker and fly to it
function handleClick() {
  if (!map.value) return;

  // AI : Use reactive data instead of scanning DOM
  const availableCities = citiesWithProjects.value;

  if (availableCities.length === 0) return;

  // AI : Find nearest city
  const center = map.value.getCenter();
  let nearestCity: (typeof availableCities)[0] | null = null;
  let minDistance = Infinity;

  // AI : Find nearest city by distance
  for (const city of availableCities) {
    // AI : Simple Euclidean distance is enough for this
    const distance = Math.sqrt((center.lat - city.lat) ** 2 + (center.lng - city.lng) ** 2);

    if (distance < minDistance) {
      minDistance = distance;
      nearestCity = city;
    }
  }

  if (nearestCity) {
    // AI : Store reference to avoid closure issues
    const targetCity = nearestCity;

    mobileAwareFlyTo([targetCity.lat, targetCity.lng], 14, {
      duration: 1.5,
    });

    // AI : Try to find the DOM element just for the click interaction simulation
    // AI : We do this lazily only on click, not constantly
    setTimeout(() => {
      const markerSelector = `[data-city-id="${targetCity.id}"]`;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const markerElement = document.querySelector(markerSelector) as HTMLElement;

      if (markerElement) {
        markerElement.click();
      } else {
        // AI : Fallback if marker not found in DOM (should ideally not happen if synced)
        // AI : We can try to simulate what the click does directly if needed,
        // AI : but for now let's hope the marker is rendered.
        console.warn("Marker element not found for click simulation");
      }
      visible.value = false;
    }, 1600);
  }
}

onUnmounted(() => {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
});
</script>

<style scoped>
.help-button {
  /* AI : Reset button defaults */
  appearance: none;
  font-family: inherit;
  /* AI : Layout and styling */
  position: absolute;
  top: 10px;
  /* AI : Desktop - plenty of space above */
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
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.08),
    0 0 0 1px rgba(255, 255, 255, 0.5);

  font-size: 14px;
  font-weight: 600;

  cursor: pointer;
  z-index: 1000;
  white-space: nowrap;
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

/* AI : Lower help button on mobile to avoid overlap with search/controls */
@media (max-width: 768px) {
  .help-button {
    top: 80px;
    /* AI : Account for search bar + controls on mobile */
  }
}
</style>
