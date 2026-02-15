import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";

/**
 * AI : Reset map state to view mode after logout
 * AI : This will trigger existing watchers/reactive logic to reload
 * AI : public content while hiding auth-only items
 * AI : Called from App.vue watcher on logout
 */
export function clearMapOnLogout() {
  // AI : Clear standalone project markers (which exist outside Pinia)
  clearAllStandaloneProjectMarkers();

  // AI : Switch to mode "view" (default for logged-out users)
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
