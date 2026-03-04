import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { ProjectForModeration, PendingChangeRequest } from "@/types/index";
import type { RouterOutput } from "@/client";

type PendingOverlay = RouterOutput["moderation"]["getPendingSubmissions"]["overlays"][0];

export const useModerationStore = defineStore("moderation", () => {
  const overlays = ref<PendingOverlay[]>([]);
  const projects = ref<ProjectForModeration[]>([]);
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const moderationLoaded = ref(false);

  // Country-scoped moderation - selected country code (null = not selected yet)
  const selectedCountryCode = ref<string | null>(null);

  // Cache all countries to avoid fetching on every panel mount
  const allCountries = ref<{ code: string; name: string }[]>([]);
  const countriesLoaded = ref(false);

  // Pending counts per country for dashboard indicators
  const pendingCountsByCountry = ref<Map<string, number>>(new Map());
  const pendingCountsLoaded = ref(false);

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

  function resetModerationLoaded() {
    moderationLoaded.value = false;
  }

  // Remove change requests from local state after approval/rejection
  function removeChangeRequests(changeRequestIds: string[]) {
    changeRequests.value = changeRequests.value.filter((cr) => !changeRequestIds.includes(cr.id));
  }

  function setSelectedCountryCode(countryCode: string | null) {
    selectedCountryCode.value = countryCode;
  }

  function setAllCountries(countries: { code: string; name: string }[]) {
    allCountries.value = countries;
    countriesLoaded.value = true;
  }

  function setPendingCounts(counts: { countryCode: string; total: number }[]) {
    pendingCountsByCountry.value = new Map(counts.map((c) => [c.countryCode, c.total]));
    pendingCountsLoaded.value = true;
  }

  function resetPendingCounts() {
    pendingCountsLoaded.value = false;
  }

  // Clear all state on logout/account switch
  function clearAllState() {
    overlays.value = [];
    projects.value = [];
    changeRequests.value = [];
    moderationLoaded.value = false;
    selectedCountryCode.value = null;
    allCountries.value = [];
    countriesLoaded.value = false;
    pendingCountsByCountry.value.clear();
    pendingCountsLoaded.value = false;
  }

  return {
    overlays,
    projects,
    changeRequests,
    moderationLoaded,
    selectedCountryCode,
    allCountries,
    countriesLoaded,
    pendingCountsByCountry,
    pendingCountsLoaded,
    setModerationData,
    resetModerationLoaded,
    removeChangeRequests,
    setSelectedCountryCode,
    setAllCountries,
    setPendingCounts,
    resetPendingCounts,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModerationStore, import.meta.hot));
}
