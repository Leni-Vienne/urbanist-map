import { useSubmissionStore } from "@/stores/submissionStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useUiStore } from "@/stores/uiStore";
import { useMapSessionStore } from "@/stores/mapSessionStore";

// Orchestrates sign-out: authStore handles the auth session itself, then all
// user-scoped state is cleared here to prevent data leakage between accounts.
// Living outside authStore keeps it free of dependencies on the other stores.
export async function signOut() {
  const authStore = useAuthStore();
  const signOutRequest = authStore.signOut();

  useSubmissionStore().clearAllState();
  useUiStore().clearAllState();
  useProjectStore().clearAllState();
  useOverlayStore().clearAllState();
  useModerationStore().clearAllState();
  useContributionStore().clearAllState();
  useChangeRequestStore().clearAllState();
  useFocusStore().clearAllState();

  useMapSessionStore().clearAllState();

  return await signOutRequest;
}
