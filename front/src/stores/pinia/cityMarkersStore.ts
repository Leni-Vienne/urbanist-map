// AI : ============================================================================
// AI : CITY MARKERS STORE - Manages city marker state for HMR safety
// AI : ============================================================================
// AI : This store replaces module-level variables in cityMarkers.ts to ensure
// AI : state persists correctly during HMR (Hot Module Replacement) in development.
// AI : ============================================================================

import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, shallowRef } from "vue";
import type * as L from "leaflet";

// AI : Type for unsaved city marker data
interface UnsavedCityData {
  name: string;
  nameLocal: string | null;
  lat: number;
  lng: number;
  countryCode: string;
}

export const useCityMarkersStore = defineStore("cityMarkers", () => {
  const cityMarkersLayer = shallowRef<L.LayerGroup | null>(null);
  // AI : Use shallowRef to avoid Vue's deep reactivity wrapping which breaks Leaflet marker types
  const cityMarkerMap = shallowRef<Map<string, L.Marker>>(new Map());
  // AI : Track city markers for unsaved projects (cityId → city data)
  // AI : These markers are preserved when rebuilding city marker layer from backend data
  const unsavedCityMarkers = ref<Map<number, UnsavedCityData>>(new Map());
  // AI : Flags to ensure watchers are only set up once (survives HMR via Pinia)
  const modeWatcherInitialized = ref(false);
  const cityMarkerWatcherInitialized = ref(false);

  function clearAllState() {
    cityMarkersLayer.value?.clearLayers();
    cityMarkersLayer.value = null;
    cityMarkerMap.value.clear();
    unsavedCityMarkers.value.clear();
    modeWatcherInitialized.value = false;
    cityMarkerWatcherInitialized.value = false;
  }

  return {
    cityMarkersLayer,
    cityMarkerMap,
    unsavedCityMarkers,
    modeWatcherInitialized,
    cityMarkerWatcherInitialized,
    clearAllState,
  };
});

// AI : Enable HMR for this store
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCityMarkersStore, import.meta.hot));
}
