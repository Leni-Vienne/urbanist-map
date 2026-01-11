<template>
  <Transition name="help-fade">
    <button v-if="actuallyVisible" type="button" class="help-button" @click="handleClick">
      <i class="pi pi-map-marker"></i>
      <span>{{ buttonText }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo } from "@/composables/map/useMapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const visible = ref(false);
const mapStore = useMapStore();
const uiStore = useUiStore();
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;
let checkMarkersDebounceId: ReturnType<typeof setTimeout> | null = null;

// AI : Computed visibility - hide when marker placement bar is visible
const actuallyVisible = computed(() => {
  return visible.value && !uiStore.markerPlacementBarVisible;
});

const buttonText = computed(() => {
  return t("map.clickCityMarker");
});

// AI : Hide button when user selects a city
watch(
  () => mapStore.selectedCity,
  (city) => {
    if (city) {
      visible.value = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  },
);

// AI : Query DOM for city markers
function getCityMarkersFromDOM() {
  return document.querySelectorAll("[data-city-id]");
}

// AI : Show button after delay if no city is selected
function showButtonWithDelay() {
  // AI : If timeout is already active, don't restart it (prevents flicker from repeated calls)
  if (timeoutId) return;

  timeoutId = globalThis.setTimeout(() => {
    if (!mapStore.selectedCity) {
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

// AI : Check if city markers exist and update button visibility (debounced)
function checkMarkers() {
  const cityMarkers = getCityMarkersFromDOM();

  if (cityMarkers.length > 0 && !mapStore.selectedCity) {
    // AI : City markers exist - show button after delay
    showButtonWithDelay();
  } else {
    // AI : No city markers
    hideButton();
  }
}

// AI : Debounced version to prevent excessive calls during map interactions
function debouncedCheckMarkers() {
  if (checkMarkersDebounceId) {
    clearTimeout(checkMarkersDebounceId);
  }
  checkMarkersDebounceId = globalThis.setTimeout(() => {
    checkMarkers();
  }, 100); // AI : 100ms debounce
}

// AI : Handle button click - find nearest city marker and fly to it
function handleClick() {
  if (!map.value) return;

  const markers = [...getCityMarkersFromDOM()];

  if (markers.length === 0) return;

  // AI : Find nearest marker
  const center = map.value.getCenter();
  let nearestMarker: HTMLElement | null = null;
  let minDistance = Infinity;

  // AI : Find nearest marker by distance
  for (const markerElement of markers) {
    const element = markerElement as HTMLElement;
    const lat = Number.parseFloat(element.getAttribute("data-lat") ?? "0");
    const lng = Number.parseFloat(element.getAttribute("data-lng") ?? "0");

    const distance = Math.sqrt((center.lat - lat) ** 2 + (center.lng - lng) ** 2);

    if (distance < minDistance) {
      minDistance = distance;
      nearestMarker = element;
    }
  }

  if (nearestMarker) {
    const markerToClick: HTMLElement = nearestMarker;
    const lat = Number.parseFloat(markerToClick.getAttribute("data-lat") ?? "0");
    const lng = Number.parseFloat(markerToClick.getAttribute("data-lng") ?? "0");

    mobileAwareFlyTo([lat, lng], 14, {
      duration: 1.5,
    });

    setTimeout(() => {
      markerToClick.click();
      visible.value = false;
    }, 1600);
  }
}

onMounted(() => {
  // AI : Set up MutationObserver to watch for marker changes
  observer = new MutationObserver(() => {
    debouncedCheckMarkers();
  });

  const mapContainer = document.getElementById("mapDiv");
  if (mapContainer) {
    observer.observe(mapContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-city-id"],
    });
  }
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  if (checkMarkersDebounceId) {
    clearTimeout(checkMarkersDebounceId);
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
