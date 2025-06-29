<template>
  <Button
    :icon="showMarkers ? 'pi pi-eye-slash' : 'pi pi-eye'"
    :label="showMarkers ? 'Hide city markers' : 'Show city markers'"
    :class="{
      'p-button-success': showMarkers,
      'p-button-secondary': !showMarkers
    }"
    @click="toggleMarkers"
    :loading="isLoading"
    size="small"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  citiesWithProjects,
  isLoadingCities,
  removeCityMarkers,
  initializeCityMarkers,
  addCityMarkersToMap
} from '@composables/map/useCityMarkers';

// AI : Local state for markers visibility (start with true since markers are likely visible on load)
const showMarkers = ref(true);

// AI : Computed properties
const isLoading = computed(() => isLoadingCities.value);

// AI : Methods
async function toggleMarkers(): Promise<void> {
  try {
    if (showMarkers.value) {
      // AI : Hide markers
      removeCityMarkers();
      showMarkers.value = false;
    } else {
      // AI : Show markers - always remove first to prevent duplicates
      removeCityMarkers();

      if (citiesWithProjects.value.length === 0) {
        // AI : Load cities if not already loaded
        await initializeCityMarkers();
      } else {
        // AI : Add markers back to map
        addCityMarkersToMap();
      }
      showMarkers.value = true;
    }
  } catch (error) {
    console.error('AI : Error toggling city markers:', error);
  }
}
</script>