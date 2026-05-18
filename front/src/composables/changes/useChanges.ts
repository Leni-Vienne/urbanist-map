import { computed } from "vue";
import { trpc, type RouterInput } from "@/client";
import type { FieldChange } from "@shared/validation/schemas";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useChangeRequestStore, type ChangeRequest } from "@/stores/pinia/changeRequestStore";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerPosition, updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import L from "leaflet";
import type { OverlayObject } from "@/types";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";

type SubmitChangeRequestInput = RouterInput["changes"]["submitChangeRequest"];

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
  overlayStore.updateOverlay(overlayId, {
    isModified: false,
    history: overlayObject.corners.length === 4 ? [overlayObject.corners] : [],
    redoStack: [],
  });
  overlayObject.isModified = false;
  overlayObject.history = overlayObject.corners.length === 4 ? [overlayObject.corners] : [];
  overlayObject.redoStack = [];
  const layer = getLayer(overlayId);
  if (layer && overlayObject.corners.length === 4) {
    const leafletCorners = overlayObject.corners.map((corner) => L.latLng(corner.lat, corner.lng));
    layer.setCorners(leafletCorners);
    updateMarkerPosition(overlayObject);
  }
}

/** Ensures pending change requests are loaded. Safe to call outside Vue setup. */
export async function refreshPendingChangeRequests(forceUserOnly = false) {
  const store = useChangeRequestStore();
  if (store.loaded) return;
  store.setLoading(true);
  try {
    const { isModerator } = useAuthStore();
    const result = await withErrorHandling(
      async () =>
        isModerator && !forceUserOnly
          ? trpc.changes.getPendingChangeRequests.query()
          : trpc.changes.getMyChangeRequests.query(),
      { errorMessage: "Failed to fetch pending change requests" },
    );
    if (result) {
      store.setPendingChangeRequests(result);
    }
  } finally {
    store.setLoading(false);
  }
}

export function useChangeRequests() {
  const store = useChangeRequestStore();

  async function submitChangeRequest(input: SubmitChangeRequestInput) {
    store.setLoading(true);
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.submitChangeRequest.mutate(input),
        { errorMessage: "Failed to submit change request" },
      );

      if (result) {
        store.resetLoaded();
        await refreshPendingChangeRequests();
      }

      return result;
    } finally {
      store.setLoading(false);
    }
  }

  async function approveChangeRequests(changeRequestIds: string[]) {
    store.setLoading(true);
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.approveChangeRequests.mutate({ changeRequestIds }),
        { errorMessage: "Failed to approve change requests" },
      );

      if (result) {
        // Competing changes for the same field are marked 'conflicted' by the backend;
        // reset both stores so the UI reflects that.
        const moderationStore = useModerationStore();
        moderationStore.resetModerationLoaded();
        store.resetLoaded();
      }

      return result;
    } finally {
      store.setLoading(false);
    }
  }

  async function rejectChangeRequests(changeRequestIds: string[]) {
    store.setLoading(true);
    try {
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
    } finally {
      store.setLoading(false);
    }
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
    store.setLoading(true);
    try {
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
    } finally {
      store.setLoading(false);
    }
  }

  async function submitMultipleFieldChanges(
    entityType: "project" | "overlay",
    entityId: string,
    fieldChanges: FieldChange[],
  ) {
    return withErrorHandling(
      async () =>
        submitChangeRequest({
          entityType,
          entityId,
          changes: fieldChanges,
        }),
      { errorMessage: "Failed to submit multiple field changes", rethrow: true },
    );
  }

  return {
    pendingChangeRequests: computed(() => store.pendingChangeRequests),
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    deleteChangeRequest,
    resetChangeRequestsLoaded: store.resetLoaded,

    submitMultipleFieldChanges,
  };
}
