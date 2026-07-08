import { trpc } from "@/client";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore, type ChangeRequest } from "@/stores/changeRequestStore";
import { loadOrNull } from "@/services/core/errorHandling";
import { useOverlayStore } from "@/stores/overlayStore";
import type { OverlayObject } from "@/types";
import { applyOverlayBackendFields } from "@/services/overlay/sync";
import { refreshMapSessionData } from "@/services/map/viewportTriggers";

// Clearing the change-request fields makes the baseline the resting position/caption again;
// applyOverlayBackendFields reconciles the position state to baseline and snaps an unedited overlay
// back to it (staged edits are kept).
function clearOverlayChangeRequestState(overlayObject: OverlayObject) {
  applyOverlayBackendFields(overlayObject, {
    hasPendingChanges: false,
    suggestedCorners: undefined,
    suggestedCaption: undefined,
  });
}

/** Ensures the current user's pending change requests are loaded; `force` refetches even if already loaded. */
export async function refreshPendingChangeRequests(options?: { force?: boolean }) {
  const changeRequestStore = useChangeRequestStore();
  if (changeRequestStore.loaded && !options?.force) return;
  const result = await loadOrNull(async () => trpc.changes.getMyChangeRequests.query(), {
    errorMessage: "Failed to fetch pending change requests",
  });
  if (result) {
    changeRequestStore.setPendingChangeRequests(result);
  }
}

export async function approveChangeRequests(changeRequestIds: string[]) {
  const result = await loadOrNull(
    async () => trpc.changes.approveChangeRequests.mutate({ changeRequestIds }),
    { errorMessage: "Failed to approve change requests" },
  );

  if (result) {
    // The approved changes plus any competing changes the backend marked 'conflicted' are no
    // longer pending. Drop them from the moderation panel locally instead of refetching every
    // pending submission for the country.
    const moderationStore = useModerationStore();
    moderationStore.removeChangeRequests(result.resolvedChangeRequestIds);
    // The current user's own change requests are fetched lazily, so just invalidate; a conflicted
    // change of theirs must reappear with its conflict badge on the next My Contributions load.
    useChangeRequestStore().resetLoaded();
  }

  return result;
}

export async function rejectChangeRequests(changeRequestIds: string[]) {
  const result = await loadOrNull(
    async () => trpc.changes.rejectChangeRequests.mutate({ changeRequestIds }),
    { errorMessage: "Failed to reject change requests" },
  );

  if (result) {
    useChangeRequestStore().removeChangeRequests(changeRequestIds);

    const moderationStore = useModerationStore();
    moderationStore.removeChangeRequests(changeRequestIds);
  }

  return result;
}

function hasOtherPendingChangeRequestsForOverlay(overlayId: string): boolean {
  return useChangeRequestStore().pendingChangeRequests.some(
    (cr) => cr.entityType === "overlay" && cr.entityId === overlayId,
  );
}

function handleOverlayStateAfterDeletion(changeRequest: ChangeRequest) {
  if (changeRequest.entityType !== "overlay") {
    return;
  }

  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[changeRequest.entityId];

  if (!overlayObject) {
    return;
  }

  if (hasOtherPendingChangeRequestsForOverlay(changeRequest.entityId)) {
    return;
  }

  clearOverlayChangeRequestState(overlayObject);
}

export async function deleteChangeRequest(changeRequestId: string) {
  const store = useChangeRequestStore();
  const changeRequest = store.pendingChangeRequests.find((cr) => cr.id === changeRequestId);
  const result = await loadOrNull(
    async () => trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId }),
    { errorMessage: "Failed to delete change request" },
  );

  if (result && changeRequest) {
    store.removeChangeRequest(changeRequestId);
    handleOverlayStateAfterDeletion(changeRequest);
    // Reconcile the session map set: a withdrawn overlay CR drops out of the session list.
    if (changeRequest.entityType === "overlay") {
      await refreshMapSessionData();
    }
  }

  return result;
}
