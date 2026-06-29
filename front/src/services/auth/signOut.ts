import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useUiStore } from "@/stores/uiStore";
import { clearAll as clearAllLayers } from "@/services/overlay/mapLayers";

// Orchestrates sign-out: authStore handles the auth session itself, then all
// user-scoped state is cleared here to prevent data leakage between accounts.
// Living outside authStore keeps it free of dependencies on the other stores.
export async function signOut() {
  const authStore = useAuthStore();
  const result = await authStore.signOut();

  const uiStore = useUiStore();
  uiStore.hasUnacknowledgedModeratedContributions = false;
  uiStore.moderatedContributionsDialogVisible = false;

  useMapStore().clearAllState();
  useProjectStore().clearAllState();
  useOverlayStore().clearAllState();
  clearAllLayers(false);
  useModerationStore().clearAllState();

  return result;
}
