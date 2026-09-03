import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Overlay, Project, PendingChangeRequest } from "@/types/index";
import type { RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";

type CountryItem = RouterOutput["country"]["getAllCountries"][0];
type ModerationLoadStatus = "idle" | "loading" | "loaded";

export const useModerationStore = defineStore("moderation", () => {
  const selectedCountryCode = ref<string | null>(null);
  const projectIds = ref<string[]>([]);
  const overlaysById = ref<Record<string, Overlay>>({});
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const projects = computed<Project[]>(() => {
    const projectStore = useProjectStore();
    const result: Project[] = [];
    for (const id of projectIds.value) {
      const project = projectStore.getMapProjectById(id, "moderation");
      if (!project) continue;
      result.push(project);
    }
    return result;
  });

  const projectOverlayIds = computed<Record<string, string[]>>(() => {
    const result: Record<string, string[]> = {};
    for (const projectId of projectIds.value) result[projectId] = [];
    for (const overlay of Object.values(overlaysById.value)) {
      if (!overlay.projectId) continue;
      result[overlay.projectId]?.push(overlay.id);
    }
    return result;
  });

  const moderationLoadStatus = ref<ModerationLoadStatus>("idle");

  const allCountries = ref<CountryItem[]>([]);
  const countriesLoaded = ref(false);

  const pendingCountsByCountry = ref(new Map<string, number>());
  const pendingCountsLoaded = ref(false);

  function setModerationData(data: {
    projectIds: string[];
    overlaysById: Record<string, Overlay>;
    changeRequests: PendingChangeRequest[];
  }) {
    projectIds.value = data.projectIds;
    overlaysById.value = data.overlaysById;
    changeRequests.value = data.changeRequests;
    moderationLoadStatus.value = "loaded";
  }

  function startModerationLoading() {
    moderationLoadStatus.value = "loading";
  }

  function stopModerationLoading() {
    if (moderationLoadStatus.value === "loading") {
      moderationLoadStatus.value = "idle";
    }
  }

  function invalidateModerationData() {
    moderationLoadStatus.value = "idle";
    projectIds.value = [];
    overlaysById.value = {};
    changeRequests.value = [];
  }

  function setAllCountries(countries: CountryItem[]) {
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

  // Clear all state on logout or account switch.
  function clearAllState() {
    selectedCountryCode.value = null;
    projectIds.value = [];
    overlaysById.value = {};
    changeRequests.value = [];
    moderationLoadStatus.value = "idle";
    allCountries.value = [];
    countriesLoaded.value = false;
    pendingCountsByCountry.value.clear();
    pendingCountsLoaded.value = false;
  }

  return {
    selectedCountryCode,
    projects,
    overlaysById,
    projectOverlayIds,
    changeRequests,
    moderationLoadStatus,
    allCountries,
    countriesLoaded,
    pendingCountsByCountry,
    pendingCountsLoaded,
    setModerationData,
    startModerationLoading,
    stopModerationLoading,
    invalidateModerationData,
    setAllCountries,
    setPendingCounts,
    resetPendingCounts,
    clearAllState,
  };
});

// Enable HMR for this store
// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModerationStore, import.meta.hot));
}
