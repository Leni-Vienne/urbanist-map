import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import { trpc, type RouterOutput } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";

// Moderated contributions (rejected/replaced overlays). authStore preloads it on
// login to decide whether to open the dialog, and the dialog reads it without refetching.
export const useModeratedContributionsStore = defineStore("moderatedContributions", () => {
  const moderatedContributions = ref<RouterOutput["overlay"]["getModeratedContributions"]>([]);
  const isLoading = ref(false);
  // Set when authStore preloads on login/session-restore so the dialog can render
  // its first open without a redundant fetch. Consumed (reset) on first dialog mount.
  const hasPreloaded = ref(false);

  async function fetchModeratedContributions() {
    isLoading.value = true;
    try {
      const result = await loadOrNull(async () => trpc.overlay.getModeratedContributions.query(), {
        errorMessage: "Failed to load moderated contributions",
      });

      if (result) {
        moderatedContributions.value = result;
      }
    } finally {
      isLoading.value = false;
    }
  }

  // Called once by authStore right after login/session-restore.
  async function preloadModeratedContributions() {
    await fetchModeratedContributions();
    hasPreloaded.value = true;
  }

  // Called by the dialog on mount: reuse the preloaded data if present, otherwise
  // fetch fresh (e.g. when the user reopens the dialog later from the menu).
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

    const result = await loadOrNull(
      async () => trpc.overlay.acknowledgeModeratedContributions.mutate({ contributionIds }),
      { errorMessage: "Failed to acknowledge contributions" },
    );

    if (result) {
      moderatedContributions.value = moderatedContributions.value.filter(
        (item) => !contributionIds.includes(item.id),
      );
    }

    return result ?? { success: false };
  }

  async function acknowledgeAll() {
    const allIds = moderatedContributions.value.map((item) => item.id);
    return acknowledgeContributions(allIds);
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState() {
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
