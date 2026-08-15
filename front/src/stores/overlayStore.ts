import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { OverlayObject, OverlayHistoryState, OverlayPositionState } from "@/types/index";

// The non-staged resting state: an open change request rests on its suggested state, else baseline.
function restingPositionState(overlay: OverlayObject): OverlayPositionState {
  return overlay.hasPendingChanges === true ? "suggested" : "baseline";
}

export const useOverlayStore = defineStore("overlay", () => {
  const liveOverlays = ref<Record<string, OverlayObject>>({});

  const replacementOverlayId = ref<string | null>(null);

  function addOverlay(overlayId: string, overlay: OverlayObject) {
    liveOverlays.value[overlayId] = overlay;
  }

  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = liveOverlays.value[overlayId];
    if (!current) return;
    Object.assign(current, updates);
  }

  // Replace an overlay's edit history wholesale. Callers compute the new history array
  // (seeding/dedup live in commitOverlayEdit); this is the single reactive write.
  function commitHistory(overlayId: string, history: OverlayHistoryState[]) {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay) return;
    overlay.history = history;
    overlay.redoStack = [];
    overlay.positionState = history.length > 1 ? "staged" : restingPositionState(overlay);
  }

  // Collapse history to a single baseline step at `corners` (cloned so later edits don't alias it)
  // and clear redo. Used when a submitted/reverted position becomes the new starting point, so
  // re-entering edit mode doesn't restore prior in-progress edits. imageUrl is read from the live
  // overlay; invalid (non-4) corners clear history entirely. Does not touch baselineCorners.
  function resetHistoryBaseline(overlayId: string, corners: { lat: number; lng: number }[]) {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay) return;
    overlay.history =
      corners.length === 4
        ? [
            {
              corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
              imageUrl: overlay.imageUrl,
            },
          ]
        : [];
    overlay.redoStack = [];
    // A collapse to a single step leaves no staged edits; a toggled/suggested state written just
    // before this call is preserved (only a staged state is reconciled to the resting state).
    if (overlay.positionState === "staged") overlay.positionState = restingPositionState(overlay);
  }

  // Step back one history entry. Returns the step to restore (for the GL effect), or null on no-op.
  function undoHistory(overlayId: string): OverlayHistoryState | null {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay || overlay.history.length <= 1) return null;
    const current = overlay.history.pop();
    if (!current) return null;
    overlay.redoStack.push(current);
    const target = overlay.history.at(-1);
    if (!target) return null;
    if (overlay.history.length === 1) overlay.positionState = restingPositionState(overlay);
    return target;
  }

  // Step forward one history entry. Returns the step to restore, or null on no-op.
  function redoHistory(overlayId: string): OverlayHistoryState | null {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay || overlay.redoStack.length === 0) return null;
    const target = overlay.redoStack.pop();
    if (!target) return null;
    overlay.history.push(target);
    if (overlay.history.length > 1) overlay.positionState = "staged";
    return target;
  }

  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
  }

  function resetReplacement() {
    replacementOverlayId.value = null;
  }

  function clearLiveOverlays() {
    liveOverlays.value = {};
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState() {
    clearLiveOverlays();
    resetReplacement();
  }

  return {
    // State
    liveOverlays,
    replacementOverlayId,

    // Actions
    clearLiveOverlays,
    addOverlay,
    updateOverlay,
    commitHistory,
    resetHistoryBaseline,
    undoHistory,
    redoHistory,
    requestOverlayReplacement,
    resetReplacement,
    clearAllState,
  };
});

// Enable HMR for this store
// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOverlayStore, import.meta.hot));
}
