import { ref } from "vue";
import { trpc, type RouterOutput } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";

const moderatedContributions = ref<RouterOutput["overlay"]["getModeratedContributions"]>([]);
const isLoading = ref(false);

/**
 * Composable for managing moderated contributions (rejected/replaced overlays).
 * Only used in ModeratedContributionsDialog. Opening/closing the dialog is controlled via uiStore.
 * authStore triggers the dialog on login by checking the count directly via trpc.
 */
export function useModeratedContributions() {
  // Always fetches fresh, no cache, avoids stale data if a different user logs in
  async function fetchModeratedContributions() {
    isLoading.value = true;
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.getModeratedContributions.query(),
        { errorMessage: "Failed to load moderated contributions" },
      );

      if (result) {
        moderatedContributions.value = result;
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Acknowledge and clear specific moderated items
   * Deletes thumbnails and DB records immediately (instead of waiting 15 days)
   */
  async function acknowledgeContributions(contributionIds: string[]) {
    if (contributionIds.length === 0) return { success: false };

    const result = await withErrorHandling(
      async () => trpc.overlay.acknowledgeModeratedContributions.mutate({ contributionIds }),
      { errorMessage: "Failed to acknowledge contributions" },
    );

    if (result) {
      // Remove acknowledged items from local cache
      moderatedContributions.value = moderatedContributions.value.filter(
        (item) => !contributionIds.includes(item.id),
      );
    }

    return result ?? { success: false };
  }

  /**
   * Acknowledge all moderated contributions at once
   */
  async function acknowledgeAll() {
    const allIds = moderatedContributions.value.map((item) => item.id);
    return acknowledgeContributions(allIds);
  }

  return {
    moderatedContributions,
    isLoading,
    fetchModeratedContributions,
    acknowledgeAll,
  };
}
