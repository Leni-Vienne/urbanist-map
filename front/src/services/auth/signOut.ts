import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/mapStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useModeratedContributionsStore } from "@/stores/moderatedContributionsStore";
import { useUiStore } from "@/stores/uiStore";
import { clearOverlayDisplayPrefs } from "@/services/overlay/mapLayers";
import { clearAllStagedRenders } from "@/services/submission/stagedRenderState";
import { resetMapSessionState } from "@/services/map/viewportTriggers";

// Orchestrates sign-out: authStore handles the auth session itself, then all
// user-scoped state is cleared here to prevent data leakage between accounts.
// Living outside authStore keeps it free of dependencies on the other stores.
// Both tiers hold user-scoped data: the stores, and the module state of the map
// session services, which no store reset reaches.
export async function signOut() {
  const authStore = useAuthStore();
  const result = await authStore.signOut();

  useUiStore().clearAllState();
  useMapStore().clearAllState();
  useProjectStore().clearAllState();
  useOverlayStore().clearAllState();
  useModerationStore().clearAllState();
  useChangeRequestStore().clearAllState();
  useModeratedContributionsStore().clearAllState();
  useFocusStore().setHoverTarget(null);

  resetMapSessionState();
  clearOverlayDisplayPrefs();
  clearAllStagedRenders();

  return result;
}
