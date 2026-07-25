import { computed, ref } from "vue";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import type { LatestContribution } from "@/types/index";

// Latest contributions (overlays + standalone projects) from all users. Module-level singleton
// state: fetched once and shared across every consumer, keyed by the `loaded` flag as a cache.
const latestContributions = ref<LatestContribution[]>([]);
const loading = ref(false);
const loaded = ref(false);

export const contributions = computed(() => latestContributions.value);
export const isLoading = computed(() => loading.value);

export async function fetchLatestContributions(): Promise<void> {
  if (loaded.value) return;

  loading.value = true;
  try {
    const result = await loadOrNull(
      async () => trpc.feed.getLatestContributions.query({ limit: 20 }),
      { errorMessage: "Failed to load latest contributions. Please refresh the page." },
    );

    if (result) {
      latestContributions.value = result;
      loaded.value = true;
    }
  } finally {
    loading.value = false;
  }
}
