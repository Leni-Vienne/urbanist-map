import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { Project, Overlay, ContributionProject, PendingChangeRequest } from "@/types/index";
import type { RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";

type PendingOverlay = RouterOutput["moderation"]["getPendingSubmissions"]["overlays"][0];
type CountryItem = RouterOutput["country"]["getAllCountries"][0];

export const useModerationStore = defineStore("moderation", () => {
  const overlays = ref<PendingOverlay[]>([]);
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
      result.push({
        ...project,
        overlays: inlineOverlays,
        overlayIds: inlineOverlays.map((overlay) => overlay.id),
      });
    }
    return result;
  });

  const moderationLoaded = ref(false);

  const allCountries = ref<CountryItem[]>([]);
  const countriesLoaded = ref(false);

  const pendingCountsByCountry = ref(new Map<string, number>());
  const pendingCountsLoaded = ref(false);

  function setModerationData(data: {
    overlays: PendingOverlay[];
    projects: Project[];
    changeRequests: PendingChangeRequest[];
  }) {
    overlays.value = data.overlays;
    const nextProjectIds: string[] = [];
    const nextProjectOverlays: Record<string, Overlay[]> = {};
    const projectStore = useProjectStore();
    for (const project of data.projects) {
      const inlineOverlays = project.overlays ?? [];
      const { overlays: _overlays, ...summary } = project;
      const current = projectStore.getProjectById(project.id);
      const backendProject = projectStore.getMapProjectById(project.id, "moderation");
      projectStore.adoptBackendProjectSummary({
        ...summary,
        geometry: backendProject?.geometry ?? summary.geometry,
        overlayIds: current?.overlayIds ?? inlineOverlays.map((overlay) => overlay.id),
      });
      nextProjectIds.push(project.id);
      nextProjectOverlays[project.id] = inlineOverlays;
    }
    projectIds.value = nextProjectIds;
    projectOverlays.value = nextProjectOverlays;
    changeRequests.value = data.changeRequests;
    moderationLoaded.value = true;
  }

  function resetModerationLoaded() {
    moderationLoaded.value = false;
    overlays.value = [];
    projectIds.value = [];
    projectOverlays.value = {};
    changeRequests.value = [];
  }

  // A project belongs in the moderation list only while it still has something pending:
  // the project itself, one of its overlays, or a change request on either.
  function hasPendingModerationContent(project: Project): boolean {
    if (project.status === "pending") return true;
    const inlineOverlays = project.overlays ?? [];
    if (inlineOverlays.some((overlay) => overlay.status === "pending")) return true;

    const overlayIds = new Set(inlineOverlays.map((overlay) => overlay.id));
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
    const retainedIds = new Set(
      projects.value.filter(hasPendingModerationContent).map((project) => project.id),
    );
    projectIds.value = projectIds.value.filter((id) => retainedIds.has(id));
    for (const id of Object.keys(projectOverlays.value)) {
      if (retainedIds.has(id)) continue;
      // oxlint-disable-next-line no-dynamic-delete
      delete projectOverlays.value[id];
    }
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

  // Adjust a country's pending badge locally after a successful approval/rejection,
  // avoiding a full refetch. Removes the entry once it reaches zero.
  function decrementPendingCount(countryCode: string | null) {
    if (!countryCode) return;
    const current = pendingCountsByCountry.value.get(countryCode);
    if (current === undefined) return;
    const next = current - 1;
    if (next > 0) {
      pendingCountsByCountry.value.set(countryCode, next);
    } else {
      pendingCountsByCountry.value.delete(countryCode);
    }
  }

  // Clear all state on logout or account switch.
  function clearAllState() {
    overlays.value = [];
    projectIds.value = [];
    projectOverlays.value = {};
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
    decrementPendingCount,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModerationStore, import.meta.hot));
}
