import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { OverlayObject, OverlayData } from "@/types/index";
import { clearAll as clearAllLayers } from "@/services/overlay/overlayRenderRegistry";

export const useOverlayStore = defineStore("overlay", () => {
  const overlays = ref<Record<string, OverlayObject>>({});
  const idSelectedOverlay = ref<string | null>(null);

  // Edit mode overlay cache - stores overlay modifications for persistence across zoom changes
  type EditModeCache = { corners: { lat: number; lng: number }[]; isModified: boolean };
  const editModeOverlayCache = ref<Map<string, EditModeCache>>(new Map());

  // Overlay data for different modes
  const viewModeOverlays = ref<OverlayData[]>([]);
  const loadedEditOverlays = ref<Set<string>>(new Set());

  // UI state
  const replacementOverlayId = ref<string | null>(null);
  const pendingImageFile = ref<File | null>(null);
  const showInfoPopup = ref(false);
  const infoPopupOverlayId = ref<string | null>(null);

  // Basic actions
  function setViewModeOverlays(overlayData: OverlayData[]) {
    viewModeOverlays.value = overlayData;
  }

  function clearViewModeOverlays() {
    viewModeOverlays.value = [];
  }

  // Edit mode cache management
  function saveToEditModeCache(overlayId: string, data: EditModeCache) {
    editModeOverlayCache.value.set(overlayId, data);
  }

  function getFromEditModeCache(overlayId: string): EditModeCache | undefined {
    return editModeOverlayCache.value.get(overlayId);
  }

  function removeFromEditModeCache(overlayId: string) {
    editModeOverlayCache.value.delete(overlayId);
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
    // Don't reset replacement (which clears pendingImageFile) if we have a pending file
    // This preserves the file during dialog navigation in overlay import flow
    if (!pendingImageFile.value) {
      resetReplacement();
    }
  }

  // Clear user-specific state on logout/account switch
  // NOTE: We preserve public data (viewModeOverlays) and only clear user-specific or edit-mode data
  function clearAllState() {
    // Remove all Leaflet layers and markers from map via registry (replaces manual iteration)
    clearAllLayers(false);

    // Clear overlay data (may contain unapproved user content)
    overlays.value = {};
    idSelectedOverlay.value = null;

    // Clear edit mode cache and state (user-specific)
    editModeOverlayCache.value.clear();
    loadedEditOverlays.value.clear();

    // KEEP viewModeOverlays - these are approved overlays for current city

    // Clear all UI state
    resetAllUIStates();
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    viewModeOverlays,
    loadedEditOverlays,
    replacementOverlayId,
    pendingImageFile,
    showInfoPopup,
    infoPopupOverlayId,

    // Actions
    setViewModeOverlays,
    clearViewModeOverlays,
    saveToEditModeCache,
    getFromEditModeCache,
    removeFromEditModeCache,
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
