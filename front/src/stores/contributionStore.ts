import { useMapSessionStore } from "@/stores/mapSessionStore";
import { trpc } from "@/client";
import { t } from "@/locales";
import { loadOrNull } from "@/services/core/errorHandling";
import { useAuthStore } from "@/stores/authStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { overlayWireToData, projectFromWire } from "@/utils/typeFactories";

import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Overlay } from "@/types/index";

export const useContributionStore = defineStore("contribution", () => {
  const projectIds = ref<string[]>([]);
  const overlaysById = ref<Record<string, Overlay>>({});
  const loading = ref(false);
  const loaded = ref(false);

  let loadToken = 0;

  // A submission receipt is newer than any contributions request already in flight.
  function invalidateRequests(): void {
    loadToken += 1;
    loading.value = false;
  }

  async function refresh(): Promise<void> {
    const authStore = useAuthStore();
    const changeRequestStore = useChangeRequestStore();
    const projectStore = useProjectStore();
    const uiStore = useUiStore();
    const mapSessionStore = useMapSessionStore();
    const userId = authStore.user?.id;
    if (!userId) return;

    loadToken += 1;
    const token = loadToken;
    const epoch = authStore.getSessionEpoch();
    loading.value = true;
    try {
      const result = await loadOrNull(
        async () => {
          const [data, { changeRequestFromWire }] = await Promise.all([
            trpc.project.getUsersContributions.query(),
            import("@/services/changes/changeRequestData"),
          ]);
          return { ...data, changeRequests: data.changeRequests.map(changeRequestFromWire) };
        },
        { errorMessage: t("contribute.loadContributionsError") },
      );
      if (
        result &&
        token === loadToken &&
        epoch === authStore.getSessionEpoch() &&
        authStore.user?.id === userId
      ) {
        if (uiStore.mode === "edit") {
          mapSessionStore.applyMapSessionRows(
            "edit",
            result.editSession.projects,
            result.editSession.overlays.map(overlayWireToData),
          );
        }
        for (const project of Object.values(result.projectsById)) {
          projectStore.upsertProjectSummary(projectFromWire(project));
        }
        setData({
          projectIds: Object.keys(result.projectsById),
          overlaysById: result.overlaysById,
        });
        changeRequestStore.setPendingChangeRequests(result.changeRequests);
      }
    } finally {
      if (
        token === loadToken &&
        epoch === authStore.getSessionEpoch() &&
        authStore.user?.id === userId
      ) {
        loading.value = false;
      }
    }
  }

  function setData(data: { projectIds: string[]; overlaysById: Record<string, Overlay> }): void {
    projectIds.value = data.projectIds;
    overlaysById.value = data.overlaysById;
    loaded.value = true;
  }

  function ingestReceipt(projectId: string, images: Overlay[]): void {
    if (!projectIds.value.includes(projectId)) {
      projectIds.value.push(projectId);
    }
    for (const image of images) {
      overlaysById.value[image.id] = image;
    }
  }

  function clearAllState(): void {
    invalidateRequests();
    projectIds.value = [];
    overlaysById.value = {};
    loaded.value = false;
  }

  return {
    projectIds,
    overlaysById,
    loading,
    loaded,
    setData,
    ingestReceipt,
    refresh,
    invalidateRequests,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useContributionStore, import.meta.hot));
}
