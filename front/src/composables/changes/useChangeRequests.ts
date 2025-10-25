import { ref, computed } from 'vue';
import { trpc } from '@client';
import type {
  SubmitChangeRequestInput,
  ChangeHistoryEntry,
} from '../../types/api';
import type { RouterOutput } from '@client';
import { useAuthStore } from '@stores/authStore';
import { useModerationStore } from '@stores/pinia/moderationStore';
import { withErrorHandling } from '@composables/core/useErrorHandling';

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

      if (result?.success) {
        await refreshPendingChangeRequests();
      }

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshPendingChangeRequests() {
    // AI : Skip if already loaded
    if (changeRequestsLoaded.value) {
      return;
    }

    isLoading.value = true;
    try {
      const { isModerator } = useAuthStore();

      // AI : Use moderation route for moderations, user route for regular users
      const result = await withErrorHandling(
        async () => isModerator
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

      if (result?.success) {
        // AI : Remove approved change requests from local state instead of refetching
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

  async function rejectChangeRequests(changeRequestIds: string[]) {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.changes.rejectChangeRequests.mutate({ changeRequestIds }),
        { errorMessage: 'Failed to reject change requests' }
      );

      if (result?.success) {
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

  return {
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
    getChangeHistory,
    resetChangeRequestsLoaded,
  };
}