import { useMapStore } from "@/stores/pinia/mapStore";
import { convertOverlayToData } from "@/utils/typeFactories";
import type { OverlayObject } from "@/types/index";

/**
 * Add new overlay to city cache so it persists across zoom changes
 */
export function addNewOverlayToCityCache(overlayObject: OverlayObject, cityId: number): void {
  const mapStore = useMapStore();

  // Convert overlay to data format for caching
  const overlayData = convertOverlayToData(overlayObject);

  // Get current city cache for current mode or create empty array
  const currentCache = mapStore.getCityOverlaysAndProjectsCache(cityId, mapStore.mode) ?? [];

  // Add new overlay to cache (avoid duplicates)
  const existingIndex = currentCache.findIndex((item) => item.id === overlayObject.id);
  if (existingIndex !== -1) {
    currentCache[existingIndex] = overlayData;
  } else {
    currentCache.push(overlayData);
  }

  mapStore.setCityProjectsCache(cityId, mapStore.mode, currentCache);
}
