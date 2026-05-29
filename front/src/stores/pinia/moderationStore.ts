import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { ProjectForModeration, PendingChangeRequest } from "@/types/index";
import type { RouterOutput } from "@/client";

type PendingOverlay = RouterOutput["moderation"]["getPendingSubmissions"]["overlays"][0];
type CountryItem = RouterOutput["country"]["getAllCountries"][0];

export const useModerationStore = defineStore("moderation", () => {
  const overlays = ref<PendingOverlay[]>([]);
  const projects = ref<ProjectForModeration[]>([]);
  const changeRequests = ref<PendingChangeRequest[]>([]);

  const moderationLoaded = ref(false);

  const allCountries = ref<CountryItem[]>([]);
  const countriesLoaded = ref(false);

  const pendingCountsByCountry = ref(new Map<string, number>());
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
    overlays.value = [];
    projects.value = [];
    changeRequests.value = [];
  }

  // A project belongs in the moderation list only while it still has something pending:
  // the project itself, one of its overlays, or a change request on either.
  function hasPendingModerationContent(project: ProjectForModeration): boolean {
    if (project.status === "pending") return true;
    if (project.overlays.some((overlay) => overlay.status === "pending")) return true;

    const overlayIds = new Set(project.overlays.map((overlay) => overlay.id));
    return changeRequests.value.some(
      (cr) =>
        (cr.entityType === "project" && cr.entityId === project.id) ||
        (cr.entityType === "overlay" && overlayIds.has(cr.entityId)),
    );
  }

  function removeChangeRequests(changeRequestIds: string[]) {
    changeRequests.value = changeRequests.value.filter((cr) => !changeRequestIds.includes(cr.id));
    // Approving/rejecting a change can leave an otherwise-approved project with nothing pending;
    // drop it here so the panel matches a fresh fetch without paying for getPendingSubmissions.
    projects.value = projects.value.filter(hasPendingModerationContent);
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
    overlays.value = [];
    projects.value = [];
    changeRequests.value = [];
    moderationLoaded.value = false;
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
    allCountries,
    countriesLoaded,
    pendingCountsByCountry,
    pendingCountsLoaded,
    setModerationData,
    resetModerationLoaded,
    removeChangeRequests,
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
