import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import { trpc, type RouterOutput } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";

export const useModeratedContributionsStore = defineStore("moderatedContributions", () => {
  const moderatedContributions = ref<RouterOutput["overlay"]["getModeratedContributions"]>([]);
  const isLoading = ref(false);
  const hasPreloaded = ref(false);
  let requestVersion = 0;

  async function fetchModeratedContributions(): Promise<boolean> {
    const version = ++requestVersion;
    isLoading.value = true;
    try {
      const result = await loadOrNull(trpc.overlay.getModeratedContributions.query, {
        errorMessage: "Failed to load moderated contributions",
      });

      if (version !== requestVersion || result === null) return false;
      moderatedContributions.value = result;
      return true;
    } finally {
      if (version === requestVersion) isLoading.value = false;
    }
  }

  async function preloadModeratedContributions(): Promise<boolean> {
    hasPreloaded.value = false;
    const loaded = await fetchModeratedContributions();
    if (loaded) hasPreloaded.value = true;
    return loaded;
  }

  async function ensureModeratedContributions() {
    if (hasPreloaded.value) {
      hasPreloaded.value = false;
      return;
    }
    await fetchModeratedContributions();
  }

  // Acknowledge and clear specific moderated items. Deletes thumbnails and DB
  // records immediately (instead of waiting 15 days).
  async function acknowledgeContributions(contributionIds: string[]) {
    if (contributionIds.length === 0) return { success: false };

    try {
      const result = await trpc.overlay.acknowledgeModeratedContributions.mutate({
        contributionIds,
      });

      moderatedContributions.value = moderatedContributions.value.filter(
        (item) => !contributionIds.includes(item.id),
      );

      return result;
    } catch (error) {
      console.error("Failed to acknowledge contributions:", error);
      return { success: false };
    }
  }

  async function acknowledgeAll() {
    const allIds = moderatedContributions.value.map((item) => item.id);
    return acknowledgeContributions(allIds);
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState() {
    requestVersion++;
    moderatedContributions.value = [];
    isLoading.value = false;
    hasPreloaded.value = false;
  }

  return {
    moderatedContributions,
    isLoading,
    preloadModeratedContributions,
    ensureModeratedContributions,
    acknowledgeAll,
    clearAllState,
  };
});

// eslint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModeratedContributionsStore, import.meta.hot));
}
