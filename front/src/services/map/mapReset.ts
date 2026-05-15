import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * Clear all overlay state and standalone project markers from the map.
 * Used by change-request preview flows to enter a focused review of a single submission.
 */
export function clearAllMapContent(): void {
  clearAllOverlays();
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
}
