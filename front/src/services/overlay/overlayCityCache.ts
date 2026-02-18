// AI : Utility for managing overlay cache in city data
// AI : Extracted to break circular dependency between useOverlay.ts and useOverlayEditing.ts

import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { convertOverlayToData } from "@/utils/typeFactories";
import type { OverlayObject } from "@/types/index";

/**
 * AI : Add new overlay to city cache so it persists across zoom changes
 */
export function addNewOverlayToCityCache(overlayObject: OverlayObject, cityId: number): void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  // AI : Convert overlay to data format for caching
  const overlayData = convertOverlayToData(overlayObject);

  // AI : Get current city cache for current mode or create empty array
  const currentCache = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode) ?? [];

  // AI : Add new overlay to cache (avoid duplicates)
  const existingIndex = currentCache.findIndex((item) => item.id === overlayObject.id);
  if (existingIndex !== -1) {
    // AI : Update existing entry
    currentCache[existingIndex] = overlayData;
  } else {
    // AI : Add new entry
    currentCache.push(overlayData);
  }

  mapStore.setCityProjectsCache(cityId, overlayStore.mode, currentCache);
}
