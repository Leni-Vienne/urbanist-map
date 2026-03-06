// ============================================================================
// Combines change request handling and field-specific change utilities
// ============================================================================
import { ref, computed } from "vue";
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

// ============================================================================
// CHANGE REQUESTS
// ============================================================================

// Use the actual tRPC output type for change requests
type ChangeHistoryEntry = RouterOutput["changes"]["getChangeHistory"][number];
type ChangeRequest = RouterOutput["changes"]["getPendingChangeRequests"][number];
type SubmitChangeRequestInput = RouterInput["changes"]["submitChangeRequest"];
const pendingChangeRequests = ref<ChangeRequest[]>([]);
const changeHistory = ref<ChangeHistoryEntry[]>([]);
const isLoading = ref(false);

// Simple loaded flag for change requests
const changeRequestsLoaded = ref(false);

function clearOverlayChangeRequestState(overlayObject: OverlayObject) {
  overlayObject.hasPendingChanges = false;
  overlayObject.suggestedCorners = undefined;
  overlayObject.isViewingApprovedPosition = undefined;
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
        // Reset loaded flag to allow refresh, then fetch updated pending changes
        resetChangeRequestsLoaded();
        await refreshPendingChangeRequests();
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshPendingChangeRequests(forceUserOnly = false) {
    // Skip if already loaded
    if (changeRequestsLoaded.value) {
      return;
    }

    isLoading.value = true;
    try {
      const { isModerator } = useAuthStore();

      // Use moderation route for moderation panel, user route for My Contributions
      // forceUserOnly ensures My Contributions always shows only user's own changes
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
        // Reset and refetch all moderation data (same pattern as overlay/project approval)
        // This ensures competing change requests marked as 'conflicted' by backend are removed from UI
        // Backend marks ALL competing changes for the same field as 'conflicted' when one is approved
        const moderationStore = useModerationStore();
        moderationStore.resetModerationLoaded();

        // Reset local loaded flag as well for My Contributions panel
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
        // Remove rejected change requests from local state instead of refetching
        pendingChangeRequests.value = pendingChangeRequests.value.filter(
          (cr) => !changeRequestIds.includes(cr.id),
        );

        // Also remove from moderation store if available
        const moderationStore = useModerationStore();
        moderationStore.removeChangeRequests(changeRequestIds);
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  // ============================================================================
  // HELPER FUNCTIONS - Internal utilities for change request deletion
  // ============================================================================

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

    // Clear from both old cache and new unified store to reset position to approved
    overlayStore.removeFromEditModeCache(overlayId);
    pendingModsStore.clearModification(overlayId);

    // Reset overlay position to approved corners
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
      // Find the change request before deleting to get entity info
      const changeRequest = pendingChangeRequests.value.find((cr) => cr.id === changeRequestId);

      const result = await withErrorHandling(
        async () => trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId }),
        { errorMessage: "Failed to delete change request" },
      );

      if (result && changeRequest) {
        // Remove deleted change request from local state
        removeChangeRequestFromLocalState(changeRequestId);

        // Handle overlay-specific state updates
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

  // ============================================================================
  // FIELD CHANGES
  // ============================================================================

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
    // Change requests
    pendingChangeRequests: computed(() => pendingChangeRequests.value),
    changeHistory: computed(() => changeHistory.value),
    conflictingChanges,
    hasConflicts,
    isLoading: computed(() => isLoading.value),

    submitChangeRequest,
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    deleteChangeRequest,
    resetChangeRequestsLoaded,

    // Field changes
    submitMultipleFieldChanges,
  };
}
