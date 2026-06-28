// Composable for managing latest contributions (overlays + standalone projects) with caching
import { computed, ref } from "vue";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import type { LatestContribution } from "@/types/index";

const latestContributions = ref<LatestContribution[]>([]);
const latestContributionsLoading = ref(false);
const latestContributionsLoaded = ref(false);

export function useLatestContributions() {
  const isLoading = computed(() => latestContributionsLoading.value);
  const contributions = computed(() => latestContributions.value);

  // Fetch latest contributions - load once
  async function fetchLatestContributions() {
    // Skip if already loaded
    if (latestContributionsLoaded.value) {
      return;
    }

    latestContributionsLoading.value = true;
    try {
      const result = await loadOrNull(
        async () => trpc.feed.getLatestContributions.query({ limit: 20 }),
        { errorMessage: "Failed to load latest contributions. Please refresh the page." },
      );

      if (result) {
        latestContributions.value = result;
        latestContributionsLoaded.value = true;
      }
    } finally {
      latestContributionsLoading.value = false;
    }
  }

  return {
    isLoading,
    contributions,
    fetchLatestContributions,
  };
}
