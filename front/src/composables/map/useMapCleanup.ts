import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";

/**
 * AI : Composable for handling map state during logout
 * AI : This avoids using watchers by directly calling state updates
 * AI : The mode change to 'view' will trigger existing reactive watchers
 * AI : to reload appropriate public content
 */
export function useMapCleanup() {
  /**
   * AI : Reset map state to view mode after logout
   * AI : This will trigger existing watchers/reactive logic to reload
   * AI : public content while hiding auth-only items
   * AI : Called directly from authStore.signOut()
   */
  function clearMapOnLogout() {
    // AI : Clear standalone project markers (which exist outside Pinia)
    clearAllStandaloneProjectMarkers();

    // AI : Switch to view mode (default for logged-out users)
    // AI : This will trigger mode watchers to reload visible content
    const overlayStore = useOverlayStore();
    overlayStore.setMode("view");

    // AI : Clear selected city/project state
    const mapStore = useMapStore();
    mapStore.clearSelectedCity();

    // AI : Note: We don't manually clear/reload countries here
    // AI : The mode switch to 'view' triggers existing reactive watchers
    // AI : which will reload countries with view-mode permissions automatically
  }

  return {
    clearMapOnLogout,
  };
}
