import { ref, computed, readonly } from "vue";
import { trpc, type RouterOutput, type RouterInput } from "@/client";
import type { FieldChange } from "@shared/validation/schemas";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { withErrorHandling, withErrorToast } from "@/services/core/errorHandling";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerPosition, updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import L from "leaflet";
import type { OverlayObject } from "@/types";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";

type ChangeRequest = RouterOutput["changes"]["getPendingChangeRequests"][number];
type SubmitChangeRequestInput = RouterInput["changes"]["submitChangeRequest"];
const pendingChangeRequests = ref<ChangeRequest[]>([]);

/** Read-only accessor for service-layer code that can't use composables. */
export function getPendingChangeRequests(): ChangeRequest[] {
  return pendingChangeRequests.value;
}

/** Reactive readonly ref, use this to watch for changes in Vue composables. */
export const pendingChangeRequestsRef = readonly(pendingChangeRequests);
const isLoading = ref(false);

const changeRequestsLoaded = ref(false);

function clearOverlayChangeRequestState(overlayObject: OverlayObject) {
  overlayObject.hasPendingChanges = false;
  overlayObject.suggestedCorners = undefined;
  overlayObject.isViewingApprovedPosition = undefined;
}

/** Ensures pending change requests are loaded. Safe to call outside Vue setup. */
export async function refreshPendingChangeRequests(forceUserOnly = false) {
  if (changeRequestsLoaded.value) return;
  isLoading.value = true;
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
      pendingChangeRequests.value = result;
      changeRequestsLoaded.value = true;
    }
  } finally {
    isLoading.value = false;
  }
}

export function useChangeRequests() {
  async function submitChangeRequest(input: SubmitChangeRequestInput) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.submitChangeRequest.mutate(input),
        { errorMessage: "Failed to submit change request" },
      );

      if (result) {
        resetChangeRequestsLoaded();
        await refreshPendingChangeRequests();
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  function resetChangeRequestsLoaded() {
    changeRequestsLoaded.value = false;
  }

  async function approveChangeRequests(changeRequestIds: string[]) {
    isLoading.value = true;
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
        resetChangeRequestsLoaded();
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function rejectChangeRequests(changeRequestIds: string[]) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.rejectChangeRequests.mutate({ changeRequestIds }),
        { errorMessage: "Failed to reject change requests" },
      );

      if (result) {
        pendingChangeRequests.value = pendingChangeRequests.value.filter(
          (cr) => !changeRequestIds.includes(cr.id),
        );

        const moderationStore = useModerationStore();
        moderationStore.removeChangeRequests(changeRequestIds);
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  function removeChangeRequestFromLocalState(changeRequestId: string) {
    pendingChangeRequests.value = pendingChangeRequests.value.filter(
      (cr) => cr.id !== changeRequestId,
    );
  }

  function hasOtherPendingChangeRequestsForOverlay(overlayId: string): boolean {
    return pendingChangeRequests.value.some(
      (cr) => cr.entityType === "overlay" && cr.entityId === overlayId,
    );
  }

  function resetOverlayPositionToApproved(overlayObject: OverlayObject, overlayId: string) {
    const overlayStore = useOverlayStore();
    const pendingModsStore = usePendingModificationsStore();

    overlayStore.removeFromEditModeCache(overlayId);
    pendingModsStore.clearModification(overlayId);
    overlayObject.isModified = false;
    const layer = getLayer(overlayId);
    if (layer && overlayObject.corners.length === 4) {
      const leafletCorners = overlayObject.corners.map((corner) =>
        L.latLng(corner.lat, corner.lng),
      );
      layer.setCorners(leafletCorners);
      updateMarkerPosition(overlayObject);
    }
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

    // Check if there are any other pending change requests for this overlay
    if (hasOtherPendingChangeRequestsForOverlay(changeRequest.entityId)) {
      return;
    }

    // No other pending change requests exist, reset the overlay state
    clearOverlayChangeRequestState(overlayObject);

    // If this was a position change request, clear edit mode cache and reset position
    if (changeRequest.fieldName === "corners") {
      resetOverlayPositionToApproved(overlayObject, changeRequest.entityId);
    }

    // Update marker color and tooltip to reflect new state
    updateMarkerTooltip(overlayObject);
  }

  async function deleteChangeRequest(changeRequestId: string) {
    isLoading.value = true;
    try {
      const changeRequest = pendingChangeRequests.value.find((cr) => cr.id === changeRequestId);
      const result = await withErrorHandling(
        async () => trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId }),
        { errorMessage: "Failed to delete change request" },
      );

      if (result && changeRequest) {
        removeChangeRequestFromLocalState(changeRequestId);
        handleOverlayStateAfterDeletion(changeRequest);
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  function getConflictingChanges() {
    const conflicts = new Map<string, ChangeRequest[]>();

    for (const request of pendingChangeRequests.value) {
      if (request.status === "conflicted") {
        const key = `${request.entityType}:${request.entityId}:${request.fieldName}`;
        let list = conflicts.get(key);
        if (!list) {
          list = [];
          conflicts.set(key, list);
        }
        list.push(request);
      }
    }

    return conflicts;
  }

  const conflictingChanges = computed(() => getConflictingChanges());

  const hasConflicts = computed(() => conflictingChanges.value.size > 0);

  async function submitMultipleFieldChanges(
    entityType: "project" | "overlay",
    entityId: string,
    fieldChanges: FieldChange[],
  ) {
    return withErrorToast(
      async () =>
        submitChangeRequest({
          entityType,
          entityId,
          changes: fieldChanges,
        }),
      "Failed to submit multiple field changes",
    );
  }

  return {
    pendingChangeRequests: computed(() => pendingChangeRequests.value),
    conflictingChanges,
    hasConflicts,
    isLoading: computed(() => isLoading.value),

    submitChangeRequest,
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    deleteChangeRequest,
    resetChangeRequestsLoaded,

    submitMultipleFieldChanges,
  };
}
