import { computed } from "vue";
import { trpc } from "@/client";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useChangeRequestStore, type ChangeRequest } from "@/stores/pinia/changeRequestStore";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerPosition, updateMarkerTooltip } from "@/services/map/markers";
import type { OverlayObject } from "@/types";
import { getImageHandle } from "@/services/overlay/overlayRenderRegistry";
import { setOverlayImageCorners } from "@/services/overlay/overlayImageLayer";
import { refreshEditHandles } from "@/services/overlay/overlayEditHandles";
import { makeHistoryState } from "@/services/overlay/overlayHistory";

function clearOverlayChangeRequestState(overlayObject: OverlayObject) {
  overlayObject.hasPendingChanges = false;
  overlayObject.suggestedCorners = undefined;
  overlayObject.isViewingApprovedPosition = undefined;
}

function resetOverlayPositionToApproved(overlayObject: OverlayObject, overlayId: string) {
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();

  pendingModsStore.clearModification(overlayId);
  // Reset history to the approved baseline so re-entering edit mode doesn't restore the edits.
  const baseline =
    overlayObject.corners.length === 4
      ? [makeHistoryState(overlayObject.corners, overlayObject.imageUrl)]
      : [];
  overlayStore.updateOverlay(overlayId, {
    isModified: false,
    history: baseline,
    redoStack: [],
  });
  if (getImageHandle(overlayId) && overlayObject.corners.length === 4) {
    setOverlayImageCorners(overlayId, overlayObject.corners);
    // Re-sync the edit handles (invisible drag surface, corner markers, outline) to the
    // reverted position; otherwise they stay over the old spot and still grab drags there.
    refreshEditHandles();
    updateMarkerPosition(overlayObject);
  }
}

/** Ensures the current user's pending change requests are loaded. Safe to call outside Vue setup. */
export async function refreshPendingChangeRequests() {
  const changeRequestStore = useChangeRequestStore();
  if (changeRequestStore.loaded) return;
  const result = await withErrorHandling(async () => trpc.changes.getMyChangeRequests.query(), {
    errorMessage: "Failed to fetch pending change requests",
  });
  if (result) {
    changeRequestStore.setPendingChangeRequests(result);
  }
}

export function useChangeRequests() {
  const store = useChangeRequestStore();

  async function approveChangeRequests(changeRequestIds: string[]) {
    const result = await withErrorHandling(
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
      store.resetLoaded();
    }

    return result;
  }

  async function rejectChangeRequests(changeRequestIds: string[]) {
    const result = await withErrorHandling(
      async () => trpc.changes.rejectChangeRequests.mutate({ changeRequestIds }),
      { errorMessage: "Failed to reject change requests" },
    );

    if (result) {
      store.removeChangeRequests(changeRequestIds);

      const moderationStore = useModerationStore();
      moderationStore.removeChangeRequests(changeRequestIds);
    }

    return result;
  }

  function hasOtherPendingChangeRequestsForOverlay(overlayId: string): boolean {
    return store.pendingChangeRequests.some(
      (cr) => cr.entityType === "overlay" && cr.entityId === overlayId,
    );
  }

  function handleOverlayStateAfterDeletion(changeRequest: ChangeRequest) {
    if (changeRequest.entityType !== "overlay") {
      return;
    }

    const overlayStore = useOverlayStore();
    const overlayObject = overlayStore.overlays[changeRequest.entityId];

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

    updateMarkerTooltip(overlayObject);
  }

  async function deleteChangeRequest(changeRequestId: string) {
    const changeRequest = store.pendingChangeRequests.find((cr) => cr.id === changeRequestId);
    const result = await withErrorHandling(
      async () => trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId }),
      { errorMessage: "Failed to delete change request" },
    );

    if (result && changeRequest) {
      store.removeChangeRequest(changeRequestId);
      handleOverlayStateAfterDeletion(changeRequest);
    }

    return result;
  }

  return {
    pendingChangeRequests: computed(() => store.pendingChangeRequests),
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    deleteChangeRequest,
    resetChangeRequestsLoaded: store.resetLoaded,
  };
}
