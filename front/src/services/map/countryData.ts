import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * Clear all map content (markers, overlays, cache, and state)
 * This is called when switching between countries or logging out
 */
export function clearAllMapContent(): void {
  clearAllOverlays();
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
}
