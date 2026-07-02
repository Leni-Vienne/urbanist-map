import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { RouterOutput } from "@/client";

export type ChangeRequest = RouterOutput["changes"]["getMyChangeRequests"][number];

export const useChangeRequestStore = defineStore("changeRequest", () => {
  const pendingChangeRequests = ref<ChangeRequest[]>([]);
  const loaded = ref(false);

  function setPendingChangeRequests(items: ChangeRequest[]) {
    pendingChangeRequests.value = items;
    loaded.value = true;
  }

  function removeChangeRequest(id: string) {
    pendingChangeRequests.value = pendingChangeRequests.value.filter((cr) => cr.id !== id);
  }

  function removeChangeRequests(ids: string[]) {
    const idSet = new Set(ids);
    pendingChangeRequests.value = pendingChangeRequests.value.filter((cr) => !idSet.has(cr.id));
  }

  function resetLoaded() {
    loaded.value = false;
  }

  return {
    pendingChangeRequests,
    loaded,
    setPendingChangeRequests,
    removeChangeRequest,
    removeChangeRequests,
    resetLoaded,
  };
});

// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangeRequestStore, import.meta.hot));
}
