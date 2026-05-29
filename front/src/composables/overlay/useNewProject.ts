import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";

// Composable for handling new project button click logic (opens marker placement bar)
export function useNewProject() {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  function handleNewProjectClick(): boolean {
    if (!authStore.isAuthenticated) {
      uiStore.authModalVisible = true;
      return false;
    }

    // Close any open popups and clear selections for clean slate
    overlayStore.hideInfoPopup();
    uiStore.closeProjectInfoPopup();

    // Always switch to edit mode when contributing (no-op if already in edit mode)
    mapStore.setMode("edit");
    uiStore.markerPlacementBarVisible = true;
    return true;
  }

  return {
    handleNewProjectClick,
  };
}
