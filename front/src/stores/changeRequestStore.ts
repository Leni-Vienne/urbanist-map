import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { RouterOutput } from "@/client";

export type ChangeRequest = RouterOutput["changes"]["getMyChangeRequests"][number];

// Which change request's position the map is previewing, and how (approved vs suggested, overlay vs
// project shape). Drives the map preview render and the moderation panel's "viewed" tracking.
type PreviewState =
  | { type: "none" }
  | { type: "current"; changeId: string; overlayId: string }
  | {
      type: "suggested";
      changeId: string;
      overlayId: string;
      corners: { lat: number; lng: number }[];
    }
  | { type: "project-current"; changeId: string; projectId: string }
  | { type: "project-suggested"; changeId: string; projectId: string };

export const useChangeRequestStore = defineStore("changeRequest", () => {
  const pendingChangeRequests = ref<ChangeRequest[]>([]);
  const loaded = ref(false);

  const previewState = ref<PreviewState>({ type: "none" });

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

  // Clear user-specific state on logout or account switch.
  function clearAllState() {
    pendingChangeRequests.value = [];
    loaded.value = false;
    previewState.value = { type: "none" };
  }

  return {
    pendingChangeRequests,
    loaded,
    previewState,
    setPendingChangeRequests,
    removeChangeRequest,
    removeChangeRequests,
    resetLoaded,
    clearAllState,
  };
});

// eslint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangeRequestStore, import.meta.hot));
}
