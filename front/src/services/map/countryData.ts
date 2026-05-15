import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * Clear all map content (markers, overlays, and standalone project markers).
 * Used when switching to a different country context.
 */
export function clearAllMapContent(): void {
  clearAllOverlays();
  const overlayStore = useOverlayStore();
  overlayStore.clearViewModeOverlays();
  clearAllStandaloneProjectMarkers();
}
