import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PendingOverlay, PendingChangeRequest } from '../../types/api';
import type { ProjectForModeration } from '@types';
import type { ApprovalStatus } from '@shared/types';

export const useModerationStore = defineStore('moderation', () => {
  const overlays = ref<PendingOverlay[]>([]);
  const projects = ref<ProjectForModeration[]>([]);
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const moderationLoaded = ref(false);
  const moderationLoading = ref(false);

  // AI : Country-scoped moderation - selected country code (null = not selected yet)
  const selectedCountryCode = ref<string | null>(null);

  // AI : Cache all countries to avoid fetching on every panel mount
  const allCountries = ref<{ code: string; name: string }[]>([]);
  const countriesLoaded = ref(false);

  interface RecentAction {
    id: string;
    itemName: string;
    itemType: 'overlay' | 'project';
    previousStatus: ApprovalStatus;
    newStatus: ApprovalStatus;
    timestamp: Date;
  }

  const recentActions = ref<RecentAction[]>([]);

  function setModerationData(data: {
    overlays: PendingOverlay[];
    projects: ProjectForModeration[];
    changeRequests: PendingChangeRequest[];
  }) {
    overlays.value = data.overlays;
    
    projects.value = data.projects
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

  function setSelectedCountryCode(countryCode: string | null) {
    selectedCountryCode.value = countryCode;
  }

  function setAllCountries(countries: { code: string; name: string }[]) {
    allCountries.value = countries;
    countriesLoaded.value = true;
  }

  return {
    overlays,
    projects,
    changeRequests,
    moderationLoaded,
    moderationLoading,
    recentActions,
    selectedCountryCode,
    allCountries,
    countriesLoaded,
    setModerationData,
    setModerationLoading,
    resetModerationLoaded,
    addRecentAction,
    removeLastAction,
    removeChangeRequests,
    setSelectedCountryCode,
    setAllCountries,
  };
});
