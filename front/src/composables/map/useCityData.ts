// AI : Shared city data utilities to avoid circular dependencies
import { computed } from 'vue';
import { useMapStore } from '@stores/pinia/mapStore';
import { storeToRefs } from 'pinia';
import type { CDNOverlayData } from '@types';

// AI : Function to get store refs when needed
function getStoreRefs() {
  const mapStore = useMapStore();
  const { selectedCity } = storeToRefs(mapStore);
  return { selectedCity, mapStore };
}

// AI : Cache for city projects data to avoid repeated API calls
export const cityProjectsCache = new Map<string, CDNOverlayData[]>();

/**
 * AI : Get cached overlay data for a specific city
 * @param cityId - The city ID to get data for
 * @returns The cached overlay data or null if not found
 */
export function getCachedCityProjectsData(cityId: string): CDNOverlayData[] | null {
  return cityProjectsCache.get(cityId) ?? null;
}

/**
 * AI : Check if city projects data is cached
 * @param cityId - The city ID to check
 * @returns True if data is cached, false otherwise
 */
export function hasCachedCityProjectsData(cityId: string): boolean {
  return cityProjectsCache.has(cityId);
}

/**
 * AI : Get the currently selected city from the map store
 * @returns The selected city or null if none selected
 */
export function getSelectedCity() {
  const { selectedCity } = getStoreRefs();
  return selectedCity.value;
}

// AI : Backward compatibility - computed property that behaves like the old latestClickedCity
export const latestClickedCity = computed(() => getSelectedCity());