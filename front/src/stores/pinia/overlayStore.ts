import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { OverlayObject, OverlayData } from "@/types/index";
import { clearAll as clearAllLayers } from "@/services/overlay/overlayRenderRegistry";

export const useOverlayStore = defineStore("overlay", () => {
  const overlays = ref<Record<string, OverlayObject>>({});
  const idSelectedOverlay = ref<string | null>(null);

  const viewModeOverlays = ref<OverlayData[]>([]);

  const replacementOverlayId = ref<string | null>(null);
  const pendingImageFile = ref<File | null>(null);
  const showInfoPopup = ref(false);
  const infoPopupOverlayId = ref<string | null>(null);

  function setViewModeOverlays(overlayData: OverlayData[]) {
    viewModeOverlays.value = overlayData;
  }

  function clearViewModeOverlays() {
    viewModeOverlays.value = [];
  }

  function addOverlay(overlayId: string, overlay: OverlayObject) {
    overlays.value[overlayId] = overlay;
  }

  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = overlays.value[overlayId];
    if (!current) return;
    Object.assign(current, updates);
  }

  function batchUpdateOverlays(updates: Record<string, Partial<OverlayObject>>) {
    for (const [id, update] of Object.entries(updates)) {
      const current = overlays.value[id];
      if (current) Object.assign(current, update);
    }
  }

  function clearPendingFile() {
    pendingImageFile.value = null;
  }

  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
  }

  function resetReplacement() {
    replacementOverlayId.value = null;
    clearPendingFile();
  }

  function showInfoPopupForOverlay(overlayId: string) {
    infoPopupOverlayId.value = overlayId;
    showInfoPopup.value = true;
  }

  function hideInfoPopup() {
    showInfoPopup.value = false;
    infoPopupOverlayId.value = null;
  }

  function resetAllUIStates() {
    hideInfoPopup();
    resetReplacement();
  }

  function closeAllUIElements() {
    hideInfoPopup();
    // Don't reset replacement (which clears pendingImageFile) if a file is already pending.
    // This preserves the file during dialog navigation in the overlay import flow.
    if (!pendingImageFile.value) {
      resetReplacement();
    }
  }

  // Clear user-specific state on logout or account switch.
  // Preserves public data (viewModeOverlays) and clears user/edit-mode data.
  function clearAllState() {
    clearAllLayers(false);
    overlays.value = {};
    idSelectedOverlay.value = null;
    resetAllUIStates();
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    viewModeOverlays,
    replacementOverlayId,
    pendingImageFile,
    showInfoPopup,
    infoPopupOverlayId,

    // Actions
    setViewModeOverlays,
    clearViewModeOverlays,
    addOverlay,
    updateOverlay,
    batchUpdateOverlays,
    requestOverlayReplacement,
    resetReplacement,
    showInfoPopupForOverlay,
    hideInfoPopup,
    closeAllUIElements,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOverlayStore, import.meta.hot));
}
