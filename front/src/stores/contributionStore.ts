import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { Overlay } from "@/types/index";

export const useContributionStore = defineStore("contribution", () => {
  const projectIds = ref<string[]>([]);
  const overlaysById = ref<Record<string, Overlay>>({});
  const loading = ref(false);
  const loaded = ref(false);

  function setData(data: { projectIds: string[]; overlaysById: Record<string, Overlay> }): void {
    projectIds.value = data.projectIds;
    overlaysById.value = data.overlaysById;
    loaded.value = true;
  }

  function setLoading(value: boolean): void {
    loading.value = value;
  }

  function clearAllState(): void {
    projectIds.value = [];
    overlaysById.value = {};
    loading.value = false;
    loaded.value = false;
  }

  return {
    projectIds,
    overlaysById,
    loading,
    loaded,
    setData,
    setLoading,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useContributionStore, import.meta.hot));
}
