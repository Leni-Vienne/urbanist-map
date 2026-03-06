import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { LatestContribution } from "@/types/index";

export const useLatestContributionsStore = defineStore("latestContributions", () => {
  const latestContributions = ref<LatestContribution[]>([]);
  const latestContributionsLoading = ref(false);
  const latestContributionsLoaded = ref(false);

  function setLatestContributions(contributions: LatestContribution[]) {
    latestContributions.value = contributions;
    latestContributionsLoaded.value = true;
  }

  function setLatestContributionsLoading(loading: boolean) {
    latestContributionsLoading.value = loading;
  }

  function reset() {
    latestContributionsLoading.value = false;
    latestContributionsLoaded.value = false;
  }

  return {
    latestContributions,
    latestContributionsLoading,
    latestContributionsLoaded,
    setLatestContributions,
    setLatestContributionsLoading,
    reset,
  };
});

// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLatestContributionsStore, import.meta.hot));
}
