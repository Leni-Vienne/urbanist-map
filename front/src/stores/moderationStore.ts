import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useMapSessionStore } from "@/stores/mapSessionStore";
import { overlayWireToData } from "@/utils/typeFactories";
import { t } from "@/locales";
import { toastError } from "@/services/core/toast";
import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref, watch } from "vue";
import type { Overlay, Project, PendingChangeRequest } from "@/types/index";
import { trpc, type RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";

type CountryItem = RouterOutput["country"]["getAllCountries"][0];
type ModerationLoadStatus = "idle" | "loading" | "loaded";

export const useModerationStore = defineStore("moderation", () => {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  let moderationFetchToken = 0;
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

  function invalidateModerationData() {
    moderationFetchToken += 1;
    const mapSession = useMapSessionStore();
    if (mapSession.snapshot?.mode === "moderation") mapSession.clearAllState();
    moderationLoadStatus.value = "idle";
    projectIds.value = [];
    overlaysById.value = {};
    changeRequests.value = [];
  }

  async function fetchPendingSubmissions(options?: { force?: boolean }) {
    const mapSessionStore = useMapSessionStore();
    const countryCode = selectedCountryCode.value;
    if (!countryCode) return;
    if (!options?.force && moderationLoadStatus.value !== "idle") {
      return;
    }

    moderationFetchToken += 1;
    const requestToken = moderationFetchToken;
    const userId = authStore.user?.id;
    const epoch = authStore.getSessionEpoch();
    moderationLoadStatus.value = "loading";

    function isCurrentRequest(): boolean {
      return (
        requestToken === moderationFetchToken &&
        uiStore.mode === "moderation" &&
        selectedCountryCode.value === countryCode &&
        authStore.user?.id === userId &&
        epoch === authStore.getSessionEpoch()
      );
    }

    try {
      const [response, { changeRequestFromWire }] = await Promise.all([
        trpc.moderation.getPendingSubmissions.query({ countryCode }),
        import("@/services/changes/changeRequestData"),
      ]);

      if (!isCurrentRequest()) return;

      const parsedChanges = response.changeRequests.map(changeRequestFromWire);

      const mapProjects = [];
      for (const project of Object.values(response.projectsById)) {
        mapProjects.push({ ...project, tags: project.tags ?? [] });
      }

      const fetchedProjectIds = mapSessionStore.applyMapSessionRows(
        "moderation",
        mapProjects,
        response.mapOverlays.map(overlayWireToData),
      );

      setModerationData({
        projectIds: fetchedProjectIds,
        overlaysById: response.overlaysById,
        changeRequests: parsedChanges,
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      moderationLoadStatus.value = "idle";
      console.error("Failed to load pending submissions:", error);
      toastError(t("moderation.fetchSubmissionsFailed"));
    }
  }

  watch(selectedCountryCode, invalidateModerationData, { flush: "sync" });

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
    invalidateModerationData();
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
    fetchPendingSubmissions,
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
