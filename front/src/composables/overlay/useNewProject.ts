import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { switchMode } from "@/composables/overlay/useModeSwitching";
import { storeToRefs } from "pinia";

// AI : Composable for handling new project button click logic (opens marker placement bar)
export function useNewProject() {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const { mode } = storeToRefs(overlayStore);

  async function handleNewProjectClick() {
    if (!authStore.isAuthenticated) {
      uiStore.openAuthModal();
      return { success: false, reason: "not_authenticated" };
    }

    // AI : Close any open popups and clear selections for clean slate
    overlayStore.hideInfoPopup();
    uiStore.closeProjectInfoPopup();

    // AI : Always switch to edit mode when contributing
    if (mode.value !== "edit") {
      try {
        await switchMode("edit");
        uiStore.openMarkerPlacementBar();
        return { success: true, action: "edit_mode_and_dialog_opened" };
      } catch (error) {
        console.error("Error switching to edit mode:", error);
        return { success: false, reason: "edit_mode_error", error };
      }
    } else {
      // AI : Already in edit mode - just open marker placement bar
      uiStore.openMarkerPlacementBar();
      return { success: true, action: "dialog_opened" };
    }
  }

  return {
    handleNewProjectClick,
  };
}
