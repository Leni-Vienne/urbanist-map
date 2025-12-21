import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type L from "leaflet";
import type { OverlayObject, OverlayData, LatestContribution } from "@/types/index";
import type { MapMode } from "@shared/types";

export const useOverlayStore = defineStore("overlay", () => {
  // AI : Central store for overlay data
  const overlays = shallowRef<Record<string, OverlayObject>>({});
  const idSelectedOverlay = ref<string | null>(null);

  // AI : Tracking of all markers, even for images not currently loaded
  const allMarkers = shallowRef<Record<string, L.Marker>>({});

  // AI : Map mode state (view, edit, or moderation)
  const mode = ref<MapMode>("view");
  const isTogglingMode = ref(false);

  // AI : Edit mode overlay cache - stores overlay modifications for persistence across zoom changes
  type EditModeCache = { corners: { lat: number; lng: number }[]; isModified: boolean };
  const editModeOverlayCache = ref<Map<string, EditModeCache>>(new Map());

  // AI : Overlay data for different modes
  const viewModeOverlays = ref<OverlayData[]>([]);
  const loadedEditOverlays = ref<Set<string>>(new Set());
  const overlaysLoading = ref(false);
  const overlaysError = ref<string | null>(null);

  // AI : Latest contributions cache (overlays + standalone projects) - simple loaded flag
  const latestContributions = ref<LatestContribution[]>([]);
  const latestContributionsLoading = ref(false);
  const latestContributionsLoaded = ref(false);

  // AI : UI state
  const replacementOverlayId = ref<string | null>(null);
  const pendingImageFile = ref<File | null>(null);
  const showInfoPopup = ref(false);
  const infoPopupOverlayId = ref<string | null>(null);

  // AI : Basic actions
  function setViewModeOverlays(overlayData: OverlayData[]) {
    viewModeOverlays.value = overlayData;
    overlaysError.value = null;
  }

  function clearViewModeOverlays() {
    viewModeOverlays.value = [];
    overlaysError.value = null;
  }

  function setOverlaysLoading(loading: boolean) {
    overlaysLoading.value = loading;
  }

  function setOverlaysError(error: string | null) {
    overlaysError.value = error;
  }

  // AI : Latest contributions actions
  function setLatestContributions(contributions: LatestContribution[]) {
    latestContributions.value = contributions;
    latestContributionsLoaded.value = true;
  }

  function setLatestContributionsLoading(loading: boolean) {
    latestContributionsLoading.value = loading;
  }

  // AI : Reset latest contributions cache to force refresh on next load
  function resetLatestContributions() {
    latestContributionsLoaded.value = false;
  }

  function addEditModeOverlay(overlayId: string) {
    loadedEditOverlays.value.add(overlayId);
  }

  function removeEditModeOverlay(overlayId: string) {
    loadedEditOverlays.value.delete(overlayId);
  }

  function clearEditModeMarkersAndState() {
    // AI : Clear state
    loadedEditOverlays.value.clear();
  }

  function setMode(newMode: MapMode) {
    mode.value = newMode;
  }

  // AI : Edit mode cache management
  function saveToEditModeCache(overlayId: string, data: EditModeCache) {
    editModeOverlayCache.value.set(overlayId, data);
  }

  function getFromEditModeCache(overlayId: string): EditModeCache | undefined {
    return editModeOverlayCache.value.get(overlayId);
  }

  function clearEditModeCache() {
    editModeOverlayCache.value.clear();
  }

  function removeFromEditModeCache(overlayId: string) {
    editModeOverlayCache.value.delete(overlayId);
  }

  // AI : Update overlay in store with proper reactivity for shallowRef
  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = overlays.value[overlayId];
    if (current == null) return;

    // AI : Create new object with updates to trigger reactivity
    overlays.value = {
      ...overlays.value,
      [overlayId]: { ...current, ...updates },
    };
  }

  function handleFileSelected(file: File) {
    pendingImageFile.value = file;
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

  function toggleInfoPopup() {
    if (showInfoPopup.value) {
      hideInfoPopup();
    } else if (idSelectedOverlay.value != null) {
      showInfoPopupForOverlay(idSelectedOverlay.value);
    }
  }

  function resetAllUIStates() {
    hideInfoPopup();
    resetReplacement();
  }

  function closeAllUIElements() {
    hideInfoPopup();
    // AI : Don't reset replacement (which clears pendingImageFile) if we have a pending file
    // AI : This preserves the file during dialog navigation in overlay import flow
    if (!pendingImageFile.value) {
      resetReplacement();
    }
  }

  // AI : Clear all state on logout/account switch
  function clearAllState() {
    // AI : Clear overlays and markers
    overlays.value = {};
    allMarkers.value = {};
    idSelectedOverlay.value = null;

    // AI : Clear edit mode cache and state
    editModeOverlayCache.value.clear();
    loadedEditOverlays.value.clear();

    // AI : Clear view mode overlays
    viewModeOverlays.value = [];
    overlaysLoading.value = false;
    overlaysError.value = null;

    // AI : Clear latest contributions
    latestContributions.value = [];
    latestContributionsLoading.value = false;
    latestContributionsLoaded.value = false;

    // AI : Reset mode to view
    mode.value = "view";
    isTogglingMode.value = false;

    // AI : Clear all UI state
    resetAllUIStates();
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    allMarkers,
    mode,
    isTogglingMode,
    editModeOverlayCache,
    viewModeOverlays,
    loadedEditOverlays,
    overlaysLoading,
    overlaysError,
    latestContributions,
    latestContributionsLoading,
    latestContributionsLoaded,
    replacementOverlayId,
    pendingImageFile,
    showInfoPopup,
    infoPopupOverlayId,

    // Actions
    setViewModeOverlays,
    clearViewModeOverlays,
    setOverlaysLoading,
    setOverlaysError,
    setLatestContributions,
    setLatestContributionsLoading,
    resetLatestContributions,
    addEditModeOverlay,
    removeEditModeOverlay,
    clearEditModeMarkersAndState,
    setMode,
    saveToEditModeCache,
    getFromEditModeCache,
    clearEditModeCache,
    removeFromEditModeCache,
    updateOverlay,
    handleFileSelected,
    clearPendingFile,
    requestOverlayReplacement,
    resetReplacement,
    showInfoPopupForOverlay,
    hideInfoPopup,
    toggleInfoPopup,
    resetAllUIStates,
    closeAllUIElements,
    clearAllState,
  };
});
