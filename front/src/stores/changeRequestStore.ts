import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
import type { PendingChangeRequest } from "@/types/index";

// An explicit choice stays inert while its request is resolved or another entity is selected.
type PreviewIntent = { changeId: string; side: "current" | "suggested" } | null;
type PreviewState = { change: PendingChangeRequest; side: "current" | "suggested" } | null;

export const useChangeRequestStore = defineStore("changeRequest", () => {
  const pendingChangeRequests = ref<PendingChangeRequest[]>([]);

  const previewIntent = ref<PreviewIntent>(null);

  // Resolve the selected request once; renderers and buttons consume the same request and side.
  const previewState = computed<PreviewState>(() => {
    const selection = useFocusStore().selection;
    if (!selection) return null;
    const entityId = selection.kind === "overlay" ? selection.overlayId : selection.projectId;
    const matchesSelection = (change: PendingChangeRequest) =>
      change.entityType === selection.kind &&
      change.entityId === entityId &&
      (selection.kind === "overlay"
        ? change.fieldName === "corners" || change.fieldName === "centroid"
        : change.fieldName === "geometry");

    const intent = previewIntent.value;
    const requests =
      useUiStore().mode === "moderation"
        ? useModerationStore().changeRequests
        : pendingChangeRequests.value;
    const intended = requests.find((change) => change.id === intent?.changeId);
    const change =
      intended && matchesSelection(intended) ? intended : requests.find(matchesSelection);
    if (!change) return null;

    if (selection.kind === "overlay" && useUiStore().mode === "edit") {
      const overlay = useOverlayStore().liveOverlays[entityId];
      const side = overlay?.positionState === "approved-toggled" ? "current" : "suggested";
      if (side === "suggested" && !Array.isArray(change.newValue)) return null;
      return { change, side };
    }
    return { change, side: intent && change === intended ? intent.side : "current" };
  });

  function setPendingChangeRequests(items: PendingChangeRequest[]) {
    pendingChangeRequests.value = items;
  }

  function removeChangeRequest(id: string) {
    pendingChangeRequests.value = pendingChangeRequests.value.filter((cr) => cr.id !== id);
  }

  function removeChangeRequests(ids: string[]) {
    const idSet = new Set(ids);
    pendingChangeRequests.value = pendingChangeRequests.value.filter((cr) => !idSet.has(cr.id));
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState() {
    pendingChangeRequests.value = [];
    previewIntent.value = null;
  }

  return {
    pendingChangeRequests,
    previewIntent,
    previewState,
    setPendingChangeRequests,
    removeChangeRequest,
    removeChangeRequests,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangeRequestStore, import.meta.hot));
}
