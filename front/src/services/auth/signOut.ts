import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { usePendingModificationsStore } from "@/stores/pendingModificationsStore";
import { useModeratedContributionsStore } from "@/stores/moderatedContributionsStore";
import { useUiStore } from "@/stores/uiStore";
import { clearAll as clearAllLayers } from "@/services/overlay/mapLayers";
import { clearAllStagedRenders } from "@/services/submission/stagedRenderState";
import { clearLatestContributions } from "@/services/feed/latestContributions";

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
  const focusStore = useFocusStore();
  focusStore.clearSelection();
  focusStore.setHover(null);
  clearAllLayers(false);
  clearAllStagedRenders();
  clearLatestContributions();
  useModerationStore().clearAllState();
  useChangeRequestStore().clearAllState();
  usePendingModificationsStore().clearAllState();
  useModeratedContributionsStore().clearAllState();

  return result;
}
