<template>
  <Transition name="help-fade">
    <button
      v-if="actuallyVisible"
      type="button"
      class="appearance-none font-[inherit] absolute top-20 md:top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-3 bg-content-background text-color border-2 border-surface rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.5)] text-sm font-semibold cursor-pointer z-1000 whitespace-nowrap transition-colors duration-200 hover:bg-content-hover-background active:scale-[0.98]"
      @click="handleClick"
    >
      <i class="pi pi-map-marker text-3.5 text-primary-500"></i>
      <span>{{ buttonText }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";
import { map } from "@/services/core/map";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "vue-i18n";
import { citiesWithProjects, activateCity } from "@/services/map/cityMarkers";
const { t } = useI18n();
const visible = ref(false);
const dismissed = ref(false);
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const uiStore = useUiStore();
let timeoutId: ReturnType<typeof setTimeout> | null = null;

// Computed visibility - hide when marker placement bar is visible or dismissed
const actuallyVisible = computed(() => {
  return visible.value && !uiStore.markerPlacementBarVisible && !dismissed.value;
});

const buttonText = computed(() => {
  return t("map.clickCityMarker");
});

// Show button after delay if no city is selected and cities are available
function showButtonWithDelay() {
  // If timeout is already active, don't restart it
  if (timeoutId) return;

  timeoutId = globalThis.setTimeout(() => {
    if (!mapStore.selectedCity && citiesWithProjects.value.length > 0) {
      visible.value = true;
    }
  }, 3000);
}

// Hide button and reset state
function hideButton() {
  visible.value = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

// Check visibility rules based on state
function checkVisibility() {
  if (citiesWithProjects.value.length > 0 && !mapStore.selectedCity) {
    showButtonWithDelay();
  } else {
    hideButton();
  }
}

// Watch for changes in cities or selected city
watch(
  [() => mapStore.selectedCity, () => citiesWithProjects.value.length],
  () => {
    checkVisibility();
  },
  { immediate: true },
);

// Dismiss permanently once contributions are loaded (user found their way)
watch(
  () => overlayStore.viewModeOverlays.length > 0,
  (hasContributions) => {
    if (hasContributions) {
      dismissed.value = true;
      hideButton();
    }
  },
  { immediate: true },
);

// Handle button click - find nearest city marker and activates it
function handleClick() {
  // Use reactive data instead of scanning DOM
  const availableCities = citiesWithProjects.value;

  if (availableCities.length === 0) return;

  // Find nearest city
  const center = map.value.getCenter();
  let nearestCity: (typeof availableCities)[0] | null = null;
  let minDistance = Infinity;

  // Find nearest city by distance
  for (const city of availableCities) {
    // Simple Euclidean distance is enough for this
    const distance = Math.sqrt((center.lat - city.lat) ** 2 + (center.lng - city.lng) ** 2);

    if (distance < minDistance) {
      minDistance = distance;
      nearestCity = city;
    }
  }

  if (nearestCity) {
    activateCity(nearestCity);
    visible.value = false;
  }
}

onUnmounted(() => {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
});
</script>

<style scoped>
.help-fade-enter-active,
.help-fade-leave-active {
  transition: opacity 0.3s ease;
}

.help-fade-enter-from,
.help-fade-leave-to {
  opacity: 0;
}
</style>
