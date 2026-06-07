import { ref } from "vue";
import { map } from "@/services/core/map";
import type { CameraBounds } from "@/types/index";

const currentCameraBounds = ref<CameraBounds | null>(null);

/**
 * Initialize camera bounds tracking. The bounds are kept in sync with the map via load/move/zoom
 * events and exposed read-only through getCameraBounds.
 */
export function initializeCameraBounds() {
  const m = map.value;
  if (!m) return;

  function updateBounds() {
    try {
      const bounds = m.getBounds();
      currentCameraBounds.value = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: m.getZoom(),
      };
    } catch (error) {
      console.error("Error updating camera bounds:", error);
    }
  }

  updateBounds();

  m.on("load", updateBounds);
  m.on("moveend", updateBounds);
  m.on("zoomend", updateBounds);
}

export function getCameraBounds() {
  return currentCameraBounds;
}
