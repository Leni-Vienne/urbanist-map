import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PendingOverlay, PendingChangeRequest } from '../../types/api';
import type { ProjectForModeration } from '@types';

export const useModerationStore = defineStore('moderation', () => {
  const overlays = ref<PendingOverlay[]>([]);
  const projects = ref<ProjectForModeration[]>([]);
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const moderationLoaded = ref(false);
  const moderationLoading = ref(false);

  interface RecentAction {
    id: string;
    itemName: string;
    itemType: 'overlay' | 'project';
    previousStatus: 'pending' | 'approved' | 'rejected';
    newStatus: 'approved' | 'rejected';
    timestamp: Date;
  }

  const recentActions = ref<RecentAction[]>([]);

  function setModerationData(data: {
    overlays: PendingOverlay[];
    projects: ProjectForModeration[];
    changeRequests: PendingChangeRequest[];
  }) {
    overlays.value = data.overlays;
    projects.value = data.projects;
    changeRequests.value = data.changeRequests;
    moderationLoaded.value = true;
  }

  function setModerationLoading(loading: boolean) {
    moderationLoading.value = loading;
  }

  function resetModerationLoaded() {
    moderationLoaded.value = false;
  }

  function addRecentAction(action: RecentAction) {
    recentActions.value.unshift(action);
    recentActions.value = recentActions.value.slice(0, 5);
  }

  function removeLastAction() {
    recentActions.value = recentActions.value.slice(1);
  }

  // AI : Remove change requests from local state after approval/rejection
  function removeChangeRequests(changeRequestIds: string[]) {
    changeRequests.value = changeRequests.value.filter(
      cr => !changeRequestIds.includes(cr.id)
    );
  }

  return {
    overlays,
    projects,
    changeRequests,
    moderationLoaded,
    moderationLoading,
    recentActions,
    setModerationData,
    setModerationLoading,
    resetModerationLoaded,
    addRecentAction,
    removeLastAction,
    removeChangeRequests,
  };
});
