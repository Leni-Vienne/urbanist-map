import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import type { RouterOutput } from "@/client";

// Type for selected city data (compatible with previous latestClickedCity interface)
interface SelectedCity {
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode?: string;
}

export const useMapStore = defineStore("map", () => {
  // App mode (view, edit, moderation) — lives here alongside the mode-keyed city caches
  const mode = ref<AppMode>("view");

  function setMode(newMode: AppMode) {
    if (mode.value === newMode) return;
    mode.value = newMode;
  }

  function resetMode() {
    mode.value = "view";
  }

  // Currently selected city state (replaces the old latestClickedCity module variable)
  const selectedCity = ref<SelectedCity | null>(null);

  // Currently selected country code (set when clicking a city marker)
  const selectedCountryCode = ref<string | null>(null);

  // Current city overlays displayed
  const currentCityOverlays = ref<OverlayData[]>([]);

  // Cities lookup map (cityId → city info) for panel auto-switch
  // Populated when cities are loaded globally, avoids circular dependency
  const citiesLookup = ref<Map<number, SelectedCity>>(new Map());

  // City projects cache - mode-aware for smart caching (cityId → mode → data)
  // This allows fast mode switching without backend calls while maintaining data correctness
  const cityProjectsCache = ref<Map<number, Map<AppMode, OverlayData[]>>>(new Map());

  // City standalone projects cache - mode-aware (cityId → mode → data)
  const cityStandaloneProjectsCache = ref<
    Map<number, Map<AppMode, RouterOutput["project"]["getCityProjects"]>>
  >(new Map());

  // Set the currently selected city
  function setSelectedCity(city: SelectedCity | null) {
    // Prevent redundant updates (prevents infinite loops in watchers)
    if (selectedCity.value?.id === city?.id) return;
    selectedCity.value = city;
  }

  // Clear the selected city
  function clearSelectedCity() {
    selectedCity.value = null;
  }

  // City cache management - mode-aware
  function getCityOverlaysAndProjectsCache(cityId: number, forMode: AppMode): OverlayData[] | null {
    const cityCache = cityProjectsCache.value.get(cityId);
    if (!cityCache) return null;
    return cityCache.get(forMode) ?? null;
  }

  function setCityProjectsCache(cityId: number, forMode: AppMode, data: OverlayData[]) {
    let cityCache = cityProjectsCache.value.get(cityId);
    if (!cityCache) {
      cityCache = new Map();
      cityProjectsCache.value.set(cityId, cityCache);
    }
    cityCache.set(forMode, data);
  }

  function clearCityProjectsCache(cityId?: number, forMode?: AppMode) {
    if (cityId && forMode) {
      // Clear specific mode cache for a city
      const cityCache = cityProjectsCache.value.get(cityId);
      if (cityCache) {
        cityCache.delete(forMode);
      }
    } else if (cityId) {
      // Clear all mode caches for a city
      cityProjectsCache.value.delete(cityId);
    } else {
      // Clear entire cache
      cityProjectsCache.value.clear();
    }
  }

  // Standalone projects cache management - mode-aware
  function getCityStandaloneProjectsCache(
    cityId: number,
    forMode: AppMode,
  ): RouterOutput["project"]["getCityProjects"] | null {
    const cityCache = cityStandaloneProjectsCache.value.get(cityId);
    if (!cityCache) return null;
    return cityCache.get(forMode) ?? null;
  }

  function setCityStandaloneProjectsCache(
    cityId: number,
    forMode: AppMode,
    data: RouterOutput["project"]["getCityProjects"],
  ) {
    let cityCache = cityStandaloneProjectsCache.value.get(cityId);
    if (!cityCache) {
      cityCache = new Map();
      cityStandaloneProjectsCache.value.set(cityId, cityCache);
    }
    cityCache.set(forMode, data);
  }

  function clearCityStandaloneProjectsCache(cityId?: number, forMode?: AppMode) {
    if (cityId && forMode) {
      // Clear specific mode cache for a city
      const cityCache = cityStandaloneProjectsCache.value.get(cityId);
      if (cityCache) {
        cityCache.delete(forMode);
      }
    } else if (cityId) {
      // Clear all mode caches for a city
      cityStandaloneProjectsCache.value.delete(cityId);
    } else {
      // Clear entire cache
      cityStandaloneProjectsCache.value.clear();
    }
  }

  function clearCityCaches(cityId?: number, forMode?: AppMode) {
    clearCityProjectsCache(cityId, forMode);
    clearCityStandaloneProjectsCache(cityId, forMode);
  }

  return {
    // State
    mode,
    selectedCity,
    selectedCountryCode,
    currentCityOverlays,
    citiesLookup,
    cityProjectsCache,
    cityStandaloneProjectsCache,

    // Actions
    setMode,
    resetMode,
    setSelectedCity,
    clearSelectedCity,
    getCityOverlaysAndProjectsCache,
    setCityProjectsCache,
    getCityStandaloneProjectsCache,
    setCityStandaloneProjectsCache,
    clearCityStandaloneProjectsCache,
    clearCityCaches,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMapStore, import.meta.hot));
}
