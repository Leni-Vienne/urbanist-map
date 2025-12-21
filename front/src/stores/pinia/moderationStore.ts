import { defineStore } from "pinia";
import { ref } from "vue";
import type { PendingOverlay, PendingChangeRequest } from "../../types/api";
import type { ProjectForModeration } from "@/types/index";

export const useModerationStore = defineStore("moderation", () => {
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

  // AI : Pending counts per country for dashboard indicators
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

  function setModerationLoading(loading: boolean) {
    moderationLoading.value = loading;
  }

  function resetModerationLoaded() {
    moderationLoaded.value = false;
  }

  // AI : Remove change requests from local state after approval/rejection
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

  return {
    overlays,
    projects,
    changeRequests,
    moderationLoaded,
    moderationLoading,
    selectedCountryCode,
    allCountries,
    countriesLoaded,
    pendingCountsByCountry,
    pendingCountsLoaded,
    setModerationData,
    setModerationLoading,
    resetModerationLoaded,
    removeChangeRequests,
    setSelectedCountryCode,
    setAllCountries,
    setPendingCounts,
    resetPendingCounts,
  };
});
