<template>
  <div class="city-markers-control">
    <Button
      :icon="showMarkers ? 'pi pi-eye-slash' : 'pi pi-eye'"
      :label="showMarkers ? 'Masquer villes' : 'Afficher villes'"
      :class="{
        'p-button-success': showMarkers,
        'p-button-secondary': !showMarkers
      }"
      @click="toggleMarkers"
      :loading="isLoading"
      size="small"
      v-tooltip.right="showMarkers ? 'Masquer les marqueurs de villes' : 'Afficher les marqueurs de villes'"
    />
  </div>
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

// AI : Local state for markers visibility (default to true since they're shown by default)
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
      // AI : Show markers
      if (citiesWithProjects.value.length === 0) {
        // AI : Load cities if not already loaded
        await initializeCityMarkers();
      } else {
        // AI : Just add markers back to map
        addCityMarkersToMap();
      }
      showMarkers.value = true;
    }
  } catch (error) {
    console.error('AI : Error toggling city markers:', error);
  }
}
</script>

<style scoped>
.city-markers-control {
  width: 100%;
}
</style>
