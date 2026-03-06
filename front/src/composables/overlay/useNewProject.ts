import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { storeToRefs } from "pinia";

// Composable for handling new project button click logic (opens marker placement bar)
export function useNewProject() {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const { mode } = storeToRefs(mapStore);

  async function handleNewProjectClick() {
    if (!authStore.isAuthenticated) {
      uiStore.authModalVisible = true;
      return { success: false, reason: "not_authenticated" };
    }

    // Close any open popups and clear selections for clean slate
    overlayStore.hideInfoPopup();
    uiStore.closeProjectInfoPopup();

    // Always switch to edit mode when contributing
    if (mode.value !== "edit") {
      try {
        mapStore.setMode("edit");
        uiStore.markerPlacementBarVisible = true;
        return { success: true, action: "edit_mode_and_dialog_opened" };
      } catch (error) {
        console.error("Error switching to edit mode:", error);
        return { success: false, reason: "edit_mode_error", error };
      }
    } else {
      // Already in edit mode - just open marker placement bar
      uiStore.markerPlacementBarVisible = true;
      return { success: true, action: "dialog_opened" };
    }
  }

  return {
    handleNewProjectClick,
  };
}
