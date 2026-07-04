import { trpc } from "@/client";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore, type ChangeRequest } from "@/stores/changeRequestStore";
import { loadOrNull } from "@/services/core/errorHandling";
import { useOverlayStore } from "@/stores/overlayStore";
import { usePendingModificationsStore } from "@/stores/pendingModificationsStore";
import type { OverlayObject } from "@/types";
import { applyOverlayCorners } from "@/services/overlay/sync";

function clearOverlayChangeRequestState(overlayObject: OverlayObject) {
  overlayObject.hasPendingChanges = false;
  overlayObject.suggestedCorners = undefined;
  overlayObject.isViewingApprovedPosition = undefined;
}

function resetOverlayPositionToApproved(overlayObject: OverlayObject, overlayId: string) {
  usePendingModificationsStore().clearModification(overlayId);
  applyOverlayCorners(overlayObject, overlayObject.baselineCorners, {
    resetHistory: true,
    refreshHandles: true,
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

  if (changeRequest.fieldName === "corners") {
    resetOverlayPositionToApproved(overlayObject, changeRequest.entityId);
  }
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
  }

  return result;
}
