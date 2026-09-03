import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import type { RouterOutput } from "@/client";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
import type { PendingChangeRequest } from "@/types/index";

export type ChangeRequest =
  RouterOutput["project"]["getUsersContributions"]["changeRequests"][number];

// Which change request's position the map is previewing, and how (approved vs suggested, overlay vs
// project shape). Drives the map preview render and the moderation panel's "viewed" tracking.
type PreviewState =
  | { type: "none" }
  | { type: "current"; changeId: string; overlayId: string }
  | { type: "suggested"; changeId: string; overlayId: string }
  | { type: "project-current"; changeId: string; projectId: string }
  | { type: "project-suggested"; changeId: string; projectId: string };

// The side of a change request the user explicitly asked to preview. Stale intent (its change
// request resolved, or its entity no longer selected) is inert rather than cleared: previewState
// falls back to the selection's default derivation.
type PreviewIntent = { changeId: string; side: "current" | "suggested" } | null;

function isOverlayGeometryChange(cr: PendingChangeRequest, overlayId: string): boolean {
  return (
    cr.entityType === "overlay" &&
    cr.entityId === overlayId &&
    (cr.fieldName === "corners" || cr.fieldName === "centroid")
  );
}

function isProjectShapesChange(cr: PendingChangeRequest, projectId: string): boolean {
  return cr.entityType === "project" && cr.entityId === projectId && cr.fieldName === "geometry";
}

function findProjectShapesChange(
  requests: PendingChangeRequest[],
  projectId: string,
): PendingChangeRequest | undefined {
  for (const request of requests) {
    if (isProjectShapesChange(request, projectId)) return request;
  }
  return undefined;
}

export const useChangeRequestStore = defineStore("changeRequest", () => {
  const pendingChangeRequests = ref<ChangeRequest[]>([]);
  const loaded = ref(false);

  const previewIntent = ref<PreviewIntent>(null);

  // The change requests previews can target in the current mode: the country's pending
  // submissions in moderation mode, the user's own change requests otherwise.
  function relevantChangeRequests(): PendingChangeRequest[] {
    if (useUiStore().mode === "moderation") {
      return useModerationStore().changeRequests;
    }
    return pendingChangeRequests.value;
  }

  // Effective preview: intent × selection × change requests. The intent applies while its change
  // request still targets the selected entity; otherwise the selection's default applies. Edit
  // mode reads the shown side off the overlay's positionState (the side the reconciler renders,
  // so button state and image stay consistent); other modes default to the approved side.
  const previewState = computed<PreviewState>(() => {
    const requests = relevantChangeRequests();
    const intent = previewIntent.value;
    const intentChange = intent ? requests.find((cr) => cr.id === intent.changeId) : undefined;

    const overlayId = useFocusStore().selectedOverlayId;
    if (overlayId) {
      const geometryChange =
        intentChange && isOverlayGeometryChange(intentChange, overlayId)
          ? intentChange
          : requests.find((cr) => isOverlayGeometryChange(cr, overlayId));
      if (!geometryChange) return { type: "none" };

      if (useUiStore().mode === "edit") {
        const positionState = useOverlayStore().liveOverlays[overlayId]?.positionState;
        const side = positionState === "approved-toggled" ? "current" : "suggested";
        // The suggested position can't be shown without corners, so no preview is active.
        if (side === "suggested" && !Array.isArray(geometryChange.newValue)) {
          return { type: "none" };
        }
        return { type: side, changeId: geometryChange.id, overlayId };
      }
      const side = intent && geometryChange === intentChange ? intent.side : "current";
      return { type: side, changeId: geometryChange.id, overlayId };
    }

    const projectId = useFocusStore().selectedProjectId;
    if (!projectId) return { type: "none" };

    const shapesChange =
      intentChange && isProjectShapesChange(intentChange, projectId)
        ? intentChange
        : findProjectShapesChange(requests, projectId);
    if (!shapesChange) return { type: "none" };
    const side = intent && shapesChange === intentChange ? intent.side : "current";
    return {
      type: side === "suggested" ? "project-suggested" : "project-current",
      changeId: shapesChange.id,
      projectId,
    };
  });

  function getRelevantChangeRequest(changeId: string): PendingChangeRequest | undefined {
    for (const change of relevantChangeRequests()) {
      if (change.id === changeId) return change;
    }
    return undefined;
  }

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
    previewIntent.value = null;
  }

  return {
    pendingChangeRequests,
    loaded,
    previewIntent,
    previewState,
    getRelevantChangeRequest,
    setPendingChangeRequests,
    removeChangeRequest,
    removeChangeRequests,
    resetLoaded,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangeRequestStore, import.meta.hot));
}
