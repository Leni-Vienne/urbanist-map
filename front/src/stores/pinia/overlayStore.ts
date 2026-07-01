import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { OverlayObject, OverlayData, OverlayHistoryState } from "@/types/index";

export const useOverlayStore = defineStore("overlay", () => {
  const liveOverlays = ref<Record<string, OverlayObject>>({});

  const viewModeOverlays = ref<OverlayData[]>([]);

  const replacementOverlayId = ref<string | null>(null);

  function setViewModeOverlays(overlayData: OverlayData[]) {
    viewModeOverlays.value = overlayData;
  }

  function clearViewModeOverlays() {
    viewModeOverlays.value = [];
  }

  function addOverlay(overlayId: string, overlay: OverlayObject) {
    liveOverlays.value[overlayId] = overlay;
  }

  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = liveOverlays.value[overlayId];
    if (!current) return;
    Object.assign(current, updates);
  }

  function batchUpdateOverlays(updates: Record<string, Partial<OverlayObject>>) {
    for (const [id, update] of Object.entries(updates)) {
      const current = liveOverlays.value[id];
      if (current) Object.assign(current, update);
    }
  }

  // Replace an overlay's edit history wholesale and mark it modified. Callers compute the new
  // history array (seeding/dedup live in commitOverlayEdit); this is the single reactive write.
  function commitHistory(overlayId: string, history: OverlayHistoryState[]) {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay) return;
    overlay.history = history;
    overlay.redoStack = [];
    overlay.isModified = true;
  }

  // Collapse history to a single baseline step at `corners` (cloned so later edits don't alias it)
  // and clear redo. Used when a submitted/reverted position becomes the new starting point, so
  // re-entering edit mode doesn't restore prior in-progress edits. imageUrl is read from the live
  // overlay; invalid (non-4) corners clear history entirely. Does not touch isModified or corners.
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
    // Back to the initial state on a submitted overlay: clear the modified flag so the marker
    // returns to its status color.
    if (overlay.history.length === 1 && overlay.status !== null) overlay.isModified = false;
    return target;
  }

  // Step forward one history entry. Returns the step to restore, or null on no-op.
  function redoHistory(overlayId: string): OverlayHistoryState | null {
    const overlay = liveOverlays.value[overlayId];
    if (!overlay || overlay.redoStack.length === 0) return null;
    const target = overlay.redoStack.pop();
    if (!target) return null;
    overlay.history.push(target);
    overlay.isModified = true;
    return target;
  }

  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
  }

  function resetReplacement() {
    replacementOverlayId.value = null;
  }

  // Clear user-specific state on logout or account switch.
  // Preserves public data (viewModeOverlays) and clears user/edit-mode data.
  function clearAllState() {
    liveOverlays.value = {};
    resetReplacement();
  }

  return {
    // State
    liveOverlays,
    viewModeOverlays,
    replacementOverlayId,

    // Actions
    setViewModeOverlays,
    clearViewModeOverlays,
    addOverlay,
    updateOverlay,
    batchUpdateOverlays,
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
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOverlayStore, import.meta.hot));
}
