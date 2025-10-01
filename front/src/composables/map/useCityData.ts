// AI : Shared city data utilities - now properly using store instead of module-level state
import { useMapStore } from '@stores/pinia/mapStore';
import { storeToRefs } from 'pinia';
import type { OverlayData } from '@types';

/**
 * AI : Get cached overlay data for a specific city
 * @param cityId - The city ID to get data for
 * @returns The cached overlay data or null if not found
 */
export function getCachedCityProjectsData(cityId: string): OverlayData[] | null {
  const mapStore = useMapStore();
  return mapStore.getCityProjectsCache(cityId);
}

/**
 * AI : Check if city projects data is cached
 * @param cityId - The city ID to check
 * @returns True if data is cached, false otherwise
 */
export function hasCachedCityProjectsData(cityId: string): boolean {
  const mapStore = useMapStore();
  return mapStore.hasCityProjectsCache(cityId);
}

/**
 * AI : Get the currently selected city from the map store
 * @returns The selected city or null if none selected
 */
export function getSelectedCity() {
  const mapStore = useMapStore();
  const { selectedCity } = storeToRefs(mapStore);
  return selectedCity.value;
}