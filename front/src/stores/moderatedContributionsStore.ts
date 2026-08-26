import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import { trpc, type RouterOutput } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";

export const useModeratedContributionsStore = defineStore("moderatedContributions", () => {
  const moderatedContributions = ref<RouterOutput["overlay"]["getModeratedContributions"]>([]);
  let requestVersion = 0;

  async function fetchModeratedContributions(): Promise<boolean> {
    requestVersion += 1;
    const version = requestVersion;
    const result = await loadOrNull(trpc.overlay.getModeratedContributions.query, {
      errorMessage: "Failed to load moderated contributions",
    });

    if (version !== requestVersion || result === null) return false;
    moderatedContributions.value = result;
    return true;
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
    requestVersion += 1;
    moderatedContributions.value = [];
  }

  return {
    moderatedContributions,
    fetchModeratedContributions,
    acknowledgeAll,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModeratedContributionsStore, import.meta.hot));
}
