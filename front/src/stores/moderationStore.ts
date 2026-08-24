import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Overlay, ContributionProject, PendingChangeRequest } from "@/types/index";
import type { RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";

type CountryItem = RouterOutput["country"]["getAllCountries"][0];
type ModerationLoadStatus = "idle" | "loading" | "loaded";

export const useModerationStore = defineStore("moderation", () => {
  const projectIds = ref<string[]>([]);
  const projectOverlays = ref<Record<string, Overlay[]>>({});
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const projects = computed<ContributionProject[]>(() => {
    const projectStore = useProjectStore();
    const result: ContributionProject[] = [];
    for (const id of projectIds.value) {
      const project = projectStore.getMapProjectById(id, "moderation");
      if (!project) continue;
      const inlineOverlays = projectOverlays.value[id] ?? [];
      result.push({ ...project, overlays: inlineOverlays });
    }
    return result;
  });

  const moderationLoadStatus = ref<ModerationLoadStatus>("idle");

  const allCountries = ref<CountryItem[]>([]);
  const countriesLoaded = ref(false);

  const pendingCountsByCountry = ref(new Map<string, number>());
  const pendingCountsLoaded = ref(false);

  function setModerationData(data: {
    projects: ContributionProject[];
    changeRequests: PendingChangeRequest[];
  }) {
    const nextProjectIds: string[] = [];
    const nextProjectOverlays: Record<string, Overlay[]> = {};
    const projectStore = useProjectStore();
    for (const project of data.projects) {
      const inlineOverlays = project.overlays;
      const { overlays: _overlays, ...summary } = project;
      projectStore.adoptBackendProjectSummary(summary);
      nextProjectIds.push(project.id);
      nextProjectOverlays[project.id] = inlineOverlays;
    }
    projectIds.value = nextProjectIds;
    projectOverlays.value = nextProjectOverlays;
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
    projectOverlays.value = {};
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
    projectIds.value = [];
    projectOverlays.value = {};
    changeRequests.value = [];
    moderationLoadStatus.value = "idle";
    allCountries.value = [];
    countriesLoaded.value = false;
    pendingCountsByCountry.value.clear();
    pendingCountsLoaded.value = false;
  }

  return {
    projects,
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
