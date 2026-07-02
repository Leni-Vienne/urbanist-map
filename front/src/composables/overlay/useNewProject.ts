import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";
import { useMapStore } from "@/stores/mapStore";

// Composable for handling new project button click logic (opens marker placement bar)
export function useNewProject() {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const mapStore = useMapStore();

  function handleNewProjectClick(): boolean {
    if (!authStore.isAuthenticated) {
      uiStore.authModalVisible = true;
      return false;
    }

    // Close any open detail and clear selection for a clean slate
    focusStore.clearSelection();

    // Always switch to edit mode when contributing (no-op if already in edit mode)
    mapStore.setMode("edit");
    uiStore.markerPlacementBarVisible = true;
    return true;
  }

  return {
    handleNewProjectClick,
  };
}
