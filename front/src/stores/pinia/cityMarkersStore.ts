// AI : ============================================================================
// AI : CITY MARKERS STORE - Manages city marker state for HMR safety
// AI : ============================================================================
// AI : This store replaces module-level variables in useCityMarkers.ts to ensure
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
  // AI : Layer group for city markers
  const cityMarkersLayer = shallowRef<L.LayerGroup | null>(null);

  // AI : Map to store city ID to marker references for easy lookup
  // AI : Use shallowRef to avoid Vue's deep reactivity wrapping which breaks Leaflet marker types
  const cityMarkerMap = shallowRef<Map<string, L.Marker>>(new Map());

  // AI : Track city markers for unsaved projects (cityId → city data)
  // AI : These markers are preserved when rebuilding city marker layer from backend data
  const unsavedCityMarkers = ref<Map<number, UnsavedCityData>>(new Map());

  // AI : Flag to ensure mode watcher is only set up once
  const modeWatcherInitialized = ref(false);

  // AI : Flag to ensure city marker watcher is only set up once
  const cityMarkerWatcherInitialized = ref(false);

  // AI : Actions for layer management
  function setCityMarkersLayer(layer: L.LayerGroup | null) {
    cityMarkersLayer.value = layer;
  }

  function getCityMarkersLayer(): L.LayerGroup | null {
    return cityMarkersLayer.value;
  }

  // AI : Actions for city marker map
  function setCityMarker(cityId: string, marker: L.Marker) {
    cityMarkerMap.value.set(cityId, marker);
  }

  function getCityMarker(cityId: string): L.Marker | undefined {
    return cityMarkerMap.value.get(cityId);
  }

  function clearCityMarkerMap() {
    cityMarkerMap.value.clear();
  }

  function getAllCityMarkers(): Map<string, L.Marker> {
    return cityMarkerMap.value;
  }

  // AI : Actions for unsaved city markers
  function setUnsavedCityMarker(cityId: number, data: UnsavedCityData) {
    unsavedCityMarkers.value.set(cityId, data);
  }

  function getUnsavedCityMarker(cityId: number): UnsavedCityData | undefined {
    return unsavedCityMarkers.value.get(cityId);
  }

  function deleteUnsavedCityMarker(cityId: number) {
    unsavedCityMarkers.value.delete(cityId);
  }

  function getAllUnsavedCityMarkers(): Map<number, UnsavedCityData> {
    return unsavedCityMarkers.value;
  }

  // AI : Actions for watcher flags
  function setModeWatcherInitialized(value: boolean) {
    modeWatcherInitialized.value = value;
  }

  function isModeWatcherInitialized(): boolean {
    return modeWatcherInitialized.value;
  }

  function setCityMarkerWatcherInitialized(value: boolean) {
    cityMarkerWatcherInitialized.value = value;
  }

  function isCityMarkerWatcherInitialized(): boolean {
    return cityMarkerWatcherInitialized.value;
  }

  // AI : Clear all state (for logout, cleanup, etc.)
  function clearAllState() {
    if (cityMarkersLayer.value) {
      cityMarkersLayer.value.clearLayers();
    }
    cityMarkersLayer.value = null;
    cityMarkerMap.value.clear();
    unsavedCityMarkers.value.clear();
    modeWatcherInitialized.value = false;
    cityMarkerWatcherInitialized.value = false;
  }

  return {
    // AI : State (exposed for direct access if needed)
    cityMarkersLayer,
    cityMarkerMap,
    unsavedCityMarkers,
    modeWatcherInitialized,
    cityMarkerWatcherInitialized,

    // AI : Layer actions
    setCityMarkersLayer,
    getCityMarkersLayer,

    // AI : City marker map actions
    setCityMarker,
    getCityMarker,
    clearCityMarkerMap,
    getAllCityMarkers,

    // AI : Unsaved city marker actions
    setUnsavedCityMarker,
    getUnsavedCityMarker,
    deleteUnsavedCityMarker,
    getAllUnsavedCityMarkers,

    // AI : Watcher flag actions
    setModeWatcherInitialized,
    isModeWatcherInitialized,
    setCityMarkerWatcherInitialized,
    isCityMarkerWatcherInitialized,

    // AI : Cleanup
    clearAllState,
  };
});

// AI : Enable HMR for this store
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCityMarkersStore, import.meta.hot));
}
