// Composable for managing latest contributions (overlays + standalone projects) with caching
import { computed } from "vue";
import { useLatestContributionsStore } from "@/stores/pinia/latestContributionsStore";
import { trpc } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";

export function useLatestContributions() {
  const latestContributionsStore = useLatestContributionsStore();
  const isLoading = computed(() => latestContributionsStore.latestContributionsLoading);
  const contributions = computed(() => latestContributionsStore.latestContributions);

  // Fetch latest contributions - load once
  async function fetchLatestContributions() {
    // Skip if already loaded
    if (latestContributionsStore.latestContributionsLoaded) {
      return;
    }

    latestContributionsStore.setLatestContributionsLoading(true);
    try {
      const result = await withErrorHandling(
        async () => trpc.overlay.getLatestContributions.query({ limit: 20 }),
        { errorMessage: "Failed to load latest contributions. Please refresh the page." },
      );

      if (result) {
        latestContributionsStore.setLatestContributions(result);
      }
    } finally {
      latestContributionsStore.setLatestContributionsLoading(false);
    }
  }

  return {
    isLoading,
    contributions,
    fetchLatestContributions,
  };
}
