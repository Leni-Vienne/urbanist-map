import { trpc } from "@/client";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { loadOrNull } from "@/services/core/errorHandling";
import { refreshEditSessionData } from "@/services/map/viewportTriggers";
import { useAuthStore } from "@/stores/authStore";

let changeRequestLoadVersion = 0;

/** Ensures the current user's pending change requests are loaded; `force` refetches even if already loaded. */
export async function refreshPendingChangeRequests(options?: { force?: boolean }): Promise<void> {
  const authStore = useAuthStore();
  const userId = authStore.user?.id;
  if (!userId) return;

  const changeRequestStore = useChangeRequestStore();
  if (changeRequestStore.loaded && !options?.force) return;

  const epoch = authStore.getSessionEpoch();
  changeRequestLoadVersion += 1;
  const requestVersion = changeRequestLoadVersion;
  const result = await loadOrNull(async () => trpc.changes.getMyChangeRequests.query(), {
    errorMessage: "Failed to fetch pending change requests",
  });

  if (
    result &&
    requestVersion === changeRequestLoadVersion &&
    authStore.getSessionEpoch() === epoch &&
    authStore.user?.id === userId
  ) {
    changeRequestStore.setPendingChangeRequests(result);
  }
}

export async function approveChangeRequests(changeRequestIds: string[]) {
  try {
    await trpc.changes.approveChangeRequests.mutate({ changeRequestIds });

    // The current user's own change requests are fetched lazily, so just invalidate; a conflicted
    // change of theirs must reappear with its conflict badge on the next My Contributions load.
    useChangeRequestStore().resetLoaded();

    return true;
  } catch (error) {
    console.error("Failed to approve change requests:", error);
    return null;
  }
}

export async function rejectChangeRequests(changeRequestIds: string[]): Promise<boolean> {
  try {
    await trpc.changes.rejectChangeRequests.mutate({ changeRequestIds });

    useChangeRequestStore().removeChangeRequests(changeRequestIds);

    return true;
  } catch (error) {
    console.error("Failed to reject change requests:", error);
    return false;
  }
}

export async function deleteChangeRequest(changeRequestId: string): Promise<boolean> {
  const store = useChangeRequestStore();
  const changeRequest = store.pendingChangeRequests.find((cr) => cr.id === changeRequestId);

  try {
    await trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId });

    if (changeRequest) {
      store.removeChangeRequest(changeRequestId);
      // Reconcile the session map set: a withdrawn overlay CR drops out of the session list.
      if (changeRequest.entityType === "overlay") {
        await refreshEditSessionData();
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to delete change request:", error);
    return false;
  }
}
