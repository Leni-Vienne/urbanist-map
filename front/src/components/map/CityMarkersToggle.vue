<template>
  <ToggleButton
    :model-value="showMarkers"
    @update:model-value="toggleMarkers"
    :loading="isLoading"
    onLabel="Hide Cities"
    offLabel="Show Cities"
    onIcon="pi pi-eye-slash"
    offIcon="pi pi-eye"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  citiesWithProjects,
  isLoadingCities,
  removeCityMarkers,
  addCityMarkersForCountry,
  toggleCityMarkers,
  areCityMarkersVisible
} from '@composables/map/useCityMarkers';

// AI : Local state for markers visibility - sync with actual markers state on mount
const showMarkers = ref(false);

// AI : Computed properties
const isLoading = computed(() => isLoadingCities.value);

// AI : Sync toggle state with actual markers visibility on mount
onMounted(() => {
  showMarkers.value = areCityMarkersVisible();
});

// AI : Watch for changes in cities data to update toggle state if markers are loaded externally
watch(citiesWithProjects, () => {
  // AI : Update toggle state when cities are loaded
  setTimeout(() => {
    showMarkers.value = areCityMarkersVisible();
  }, 100); // AI : Small delay to ensure markers are added to map
}, { immediate: true });

// AI : Methods
async function toggleMarkers(newValue: boolean): Promise<void> {
  try {
    if (newValue) {
      // AI : Show markers
      if (citiesWithProjects.value.length === 0) {
        // AI : If no cities loaded, use toggle function which handles loading
        toggleCityMarkers();
      } else {
        // AI : Add markers to map with existing cities data
        addCityMarkersForCountry(citiesWithProjects.value);
      }
      showMarkers.value = true;
    } else {
      // AI : Hide markers
      removeCityMarkers();
      showMarkers.value = false;
    }
  } catch (error) {
    console.error('AI : Error toggling city markers:', error);
  }
}
</script>