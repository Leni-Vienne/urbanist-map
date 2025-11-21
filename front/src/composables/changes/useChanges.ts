// AI : ============================================================================
// AI : CHANGE REQUEST MANAGEMENT - Unified change requests and field changes
// AI : ============================================================================
// AI : Combines change request handling and field-specific change utilities
// AI : ============================================================================

import { ref, computed } from 'vue';
import { trpc } from '@client';
import type {
  SubmitChangeRequestInput,
  ChangeHistoryEntry,
} from '../../types/api';
import type { RouterOutput } from '@client';
import type { FieldChange } from '../../../../back/src/routes/changes';
import { useAuthStore } from '@stores/authStore';
import { useModerationStore } from '@stores/pinia/moderationStore';
import { withErrorHandling, withErrorToast } from '@composables/core/useErrorHandling';

// AI : ============================================================================
// AI : CHANGE REQUESTS
// AI : ============================================================================

// AI : Use the actual tRPC output type for change requests
type ChangeRequest = RouterOutput['changes']['getPendingChangeRequests'][0];
const pendingChangeRequests = ref<ChangeRequest[]>([]);
const changeHistory = ref<ChangeHistoryEntry[]>([]);
const isLoading = ref(false);

// AI : Simple loaded flag for change requests
const changeRequestsLoaded = ref(false);

export function useChangeRequests() {
  
  async function submitChangeRequest(input: SubmitChangeRequestInput) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.submitChangeRequest.mutate(input),
        { errorMessage: 'Failed to submit change request' }
      );

      if (result?.success != undefined) {
        // AI : Reset loaded flag to allow refresh, then fetch updated pending changes
        resetChangeRequestsLoaded();
        await refreshPendingChangeRequests();
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshPendingChangeRequests(forceUserOnly = false) {
    // AI : Skip if already loaded
    if (changeRequestsLoaded.value) {
      return;
    }

    isLoading.value = true;
    try {
      const { isModerator } = useAuthStore();

      // AI : Use moderation route for moderation panel, user route for My Contributions
      // AI : forceUserOnly ensures My Contributions always shows only user's own changes
      const result = await withErrorHandling(
        async () => (isModerator && !forceUserOnly)
          ? trpc.changes.getPendingChangeRequests.query()
          : trpc.changes.getMyChangeRequests.query(),
        { errorMessage: 'Failed to fetch pending change requests' }
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
        { errorMessage: 'Failed to approve change requests' }
      );

      if (result?.success != undefined) {
        // AI : Reset and refetch all moderation data (same pattern as overlay/project approval)
        // AI : This ensures competing change requests marked as 'conflicted' by backend are removed from UI
        // AI : Backend marks ALL competing changes for the same field as 'conflicted' when one is approved
        const moderationStore = useModerationStore();
        moderationStore.resetModerationLoaded();

        // AI : Reset local loaded flag as well for My Contributions panel
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
        { errorMessage: 'Failed to reject change requests' }
      );

      if (result?.success != undefined) {
        // AI : Remove rejected change requests from local state instead of refetching
        pendingChangeRequests.value = pendingChangeRequests.value.filter(
          cr => !changeRequestIds.includes(cr.id)
        );

        // AI : Also remove from moderation store if available
        const moderationStore = useModerationStore();
        moderationStore.removeChangeRequests(changeRequestIds);
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteChangeRequest(changeRequestId: string) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.deleteChangeRequest.mutate({ id: changeRequestId }),
        { errorMessage: 'Failed to delete change request' }
      );

      if (result?.success != undefined) {
        // AI : Remove deleted change request from local state
        pendingChangeRequests.value = pendingChangeRequests.value.filter(
          cr => cr.id !== changeRequestId
        );
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function getChangeHistory(entityType?: 'project' | 'overlay', entityId?: string) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.getChangeHistory.query({ entityType, entityId }),
        { errorMessage: 'Failed to fetch change history' }
      );

      if (result) {
        changeHistory.value = result;
      }
      return result;
    } finally {
      isLoading.value = false;
    }
  }

  function groupChangeRequestsByEntity() {
    const grouped = new Map<string, ChangeRequest[]>();

    pendingChangeRequests.value.forEach(request => {
      const key = `${request.entityType}:${request.entityId}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(request);
    });

    return grouped;
  }

  function getConflictingChanges() {
    const conflicts = new Map<string, ChangeRequest[]>();

    pendingChangeRequests.value.forEach(request => {
      if (request.status === 'conflicted') {
        const key = `${request.entityType}:${request.entityId}:${request.fieldName}`;
        if (!conflicts.has(key)) {
          conflicts.set(key, []);
        }
        conflicts.get(key)!.push(request);
      }
    });

    return conflicts;
  }

  const groupedChangeRequests = computed(() => groupChangeRequestsByEntity());

  const conflictingChanges = computed(() => getConflictingChanges());

  const hasConflicts = computed(() => conflictingChanges.value.size > 0);

  const hasChangeRequests = computed(() => pendingChangeRequests.value.length > 0);

  // AI : ============================================================================
  // AI : FIELD CHANGES
  // AI : ============================================================================

  async function submitProjectFieldChange(
    projectId: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    changeReason?: string
  ) {
    return withErrorToast(
      () => submitChangeRequest({
        entityType: 'project',
        entityId: projectId,
        changes: [{
          fieldName,
          oldValue,
          newValue,
          changeReason,
        }]
      }),
      'Failed to submit project field change'
    );
  }

  async function submitOverlayFieldChange(
    overlayId: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    changeReason?: string
  ) {
    return withErrorToast(
      async () => submitChangeRequest({
        entityType: 'overlay',
        entityId: overlayId,
        changes: [{
          fieldName,
          oldValue,
          newValue,
          changeReason,
        }]
      }),
      'Failed to submit overlay field change'
    );
  }

  async function submitMultipleFieldChanges(
    entityType: 'project' | 'overlay',
    entityId: string,
    fieldChanges: FieldChange[]
  ) {
    return withErrorToast(
      async () => submitChangeRequest({
        entityType,
        entityId,
        changes: fieldChanges
      }),
      'Failed to submit multiple field changes'
    );
  }

  function createFieldChangeHelper(entityType: 'project' | 'overlay', entityId: string) {
    const pendingChanges: FieldChange[] = [];

    function addFieldChange(fieldName: string, oldValue: FieldChange['oldValue'], newValue: FieldChange['newValue'], changeReason?: string) {
      const existingIndex = pendingChanges.findIndex(change => change.fieldName === fieldName);
      
      if (existingIndex >= 0) {
        pendingChanges[existingIndex] = { fieldName, oldValue, newValue, changeReason };
      } else {
        pendingChanges.push({ fieldName, oldValue, newValue, changeReason });
      }
    }

    function removeFieldChange(fieldName: string) {
      const index = pendingChanges.findIndex(change => change.fieldName === fieldName);
      if (index >= 0) {
        pendingChanges.splice(index, 1);
      }
    }

    async function submitAllChanges() {
      if (pendingChanges.length === 0) {
        throw new Error('No changes to submit');
      }

      const result = await submitMultipleFieldChanges(entityType, entityId, [...pendingChanges]);

      if (result?.success != undefined) {
        pendingChanges.length = 0;
      }

      return result;
    }

    function clearChanges() {
      pendingChanges.length = 0;
    }

    function getChanges() {
      return [...pendingChanges];
    }

    function hasChanges() {
      return pendingChanges.length > 0;
    }

    return {
      addFieldChange,
      removeFieldChange,
      submitAllChanges,
      clearChanges,
      getChanges,
      hasChanges,
    };
  }

  return {
    // AI : Change requests
    pendingChangeRequests: computed(() => pendingChangeRequests.value),
    changeHistory: computed(() => changeHistory.value),
    groupedChangeRequests,
    conflictingChanges,
    hasChangeRequests,
    hasConflicts,
    isLoading: computed(() => isLoading.value),

    submitChangeRequest,
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    deleteChangeRequest,
    getChangeHistory,
    resetChangeRequestsLoaded,

    // AI : Field changes
    submitProjectFieldChange,
    submitOverlayFieldChange,
    submitMultipleFieldChanges,
    createFieldChangeHelper,
  };
}
