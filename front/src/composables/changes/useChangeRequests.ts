import { ref, computed } from 'vue';
import { trpc } from '@client';
import type { 
  SubmitChangeRequestInput, 
  ChangeRequest,
  ChangeHistoryEntry 
} from '../../types/api';
import { useAuthStore } from '@stores/authStore';

const pendingChangeRequests = ref<ChangeRequest[]>([]);
const changeHistory = ref<ChangeHistoryEntry[]>([]);
const isLoading = ref(false);

export function useChangeRequests() {
  
  async function submitChangeRequest(input: SubmitChangeRequestInput) {
    try {
      isLoading.value = true;
      
      const result = await trpc.changes.submitChangeRequest.mutate(input);
      
      if (result.success) {
        await refreshPendingChangeRequests();
      }
      
      return result;
    } catch (error) {
      console.error('Failed to submit change request:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function refreshPendingChangeRequests() {
    try {
      isLoading.value = true;
      const { isAdmin } = useAuthStore();
      
      // AI : Use admin route for admins, user route for regular users
      const result = isAdmin 
        ? await trpc.changes.getPendingChangeRequests.query()
        : await trpc.changes.getMyChangeRequests.query();
        
      pendingChangeRequests.value = result;
    } catch (error) {
      console.error('Failed to fetch pending change requests:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function approveChangeRequests(changeRequestIds: string[]) {
    try {
      isLoading.value = true;
      
      const result = await trpc.changes.approveChangeRequests.mutate({
        changeRequestIds
      });
      
      if (result.success) {
        await refreshPendingChangeRequests();
      }
      
      return result;
    } catch (error) {
      console.error('Failed to approve change requests:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function rejectChangeRequests(changeRequestIds: string[]) {
    try {
      isLoading.value = true;
      
      const result = await trpc.changes.rejectChangeRequests.mutate({
        changeRequestIds
      });
      
      if (result.success) {
        await refreshPendingChangeRequests();
      }
      
      return result;
    } catch (error) {
      console.error('Failed to reject change requests:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function getChangeHistory(entityType?: 'project' | 'overlay', entityId?: string) {
    try {
      isLoading.value = true;
      
      const result = await trpc.changes.getChangeHistory.query({
        entityType,
        entityId
      });
      
      changeHistory.value = result;
      return result;
    } catch (error) {
      console.error('Failed to fetch change history:', error);
      throw error;
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

  const groupedChangeRequests = computed(() => groupChangeRequestsByEntity());

  const hasChangeRequests = computed(() => pendingChangeRequests.value.length > 0);

  return {
    pendingChangeRequests: computed(() => pendingChangeRequests.value),
    changeHistory: computed(() => changeHistory.value),
    groupedChangeRequests,
    hasChangeRequests,
    isLoading: computed(() => isLoading.value),
    
    submitChangeRequest,
    refreshPendingChangeRequests,
    approveChangeRequests,
    rejectChangeRequests,
    getChangeHistory,
  };
}