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

  // AI : Edit mode overlay cache - stores overlay modifications for persistence across zoom changes
  type EditModeCache = { corners: { lat: number; lng: number }[]; isModified: boolean };
  const editModeOverlayCache = ref<Map<string, EditModeCache>>(new Map());

  // AI : Overlay data for different modes
  const viewModeOverlays = ref<OverlayData[]>([]);
  const loadedEditOverlays = ref<Set<string>>(new Set());

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
  }

  function clearViewModeOverlays() {
    viewModeOverlays.value = [];
  }

  // AI : Latest contributions actions
  function setLatestContributions(contributions: LatestContribution[]) {
    latestContributions.value = contributions;
    latestContributionsLoaded.value = true;
  }

  function setLatestContributionsLoading(loading: boolean) {
    latestContributionsLoading.value = loading;
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

  function removeFromEditModeCache(overlayId: string) {
    editModeOverlayCache.value.delete(overlayId);
  }

  // AI : Add overlay to store with proper reactivity for shallowRef
  function addOverlay(overlayId: string, overlay: OverlayObject) {
    // AI : Create new object reference to trigger reactivity with shallowRef
    overlays.value = {
      ...overlays.value,
      [overlayId]: overlay,
    };
  }

  /**
   * AI : Clear markers from allMarkers cache by IDs
   * AI : Used when preserving overlay store data but needing to allow marker recreation
   */
  function clearMarkersFromCache(markerIds: string[]) {
    if (markerIds.length === 0) return;

    const markersCopy = { ...allMarkers.value };
    for (const id of markerIds) {
      delete markersCopy[id];
    }
    allMarkers.value = markersCopy;
  }

  // AI : Update overlay in store with proper reactivity for shallowRef
  function updateOverlay(overlayId: string, updates: Partial<OverlayObject>) {
    const current = overlays.value[overlayId];
    if (current === null) return;

    // AI : Create new object with updates to trigger reactivity
    overlays.value = {
      ...overlays.value,
      [overlayId]: { ...current, ...updates },
    };
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
    // AI : Don't reset replacement (which clears pendingImageFile) if we have a pending file
    // AI : This preserves the file during dialog navigation in overlay import flow
    if (!pendingImageFile.value) {
      resetReplacement();
    }
  }

  // AI : Clear user-specific state on logout/account switch
  // AI : NOTE: We preserve public data (latestContributions, viewModeOverlays)
  // AI : and only clear user-specific or edit-mode data
  function clearAllState() {
    // AI : Remove overlays and markers from Leaflet map before clearing store
    // AI : This prevents "ghost" overlays when reconnecting/reloading data
    for (const obj of Object.values(overlays.value)) {
      if (obj.overlay) {
        obj.overlay.remove();
      }
      if (obj.marker) {
        obj.marker.remove();
      }
    }

    // AI : Also ensure all markers in the cache are removed (some might not be attached to current overlays)
    for (const marker of Object.values(allMarkers.value)) {
      marker.remove();
    }

    // AI : Clear overlays and markers (may contain unapproved user content)
    overlays.value = {};
    allMarkers.value = {};
    idSelectedOverlay.value = null;

    // AI : Clear edit mode cache and state (user-specific)
    editModeOverlayCache.value.clear();
    loadedEditOverlays.value.clear();

    // AI : KEEP viewModeOverlays - these are approved overlays for current city

    // AI : KEEP latestContributions - these are public approved content
    // AI : Only reset the loaded flag to allow refresh if needed
    // latestContributions.value = [];
    latestContributionsLoading.value = false;
    latestContributionsLoaded.value = false;

    // AI : Reset mode to view
    mode.value = "view";

    // AI : Clear all UI state
    resetAllUIStates();
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    allMarkers,
    mode,
    viewModeOverlays,
    loadedEditOverlays,
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
    setLatestContributions,
    setLatestContributionsLoading,
    setMode,
    saveToEditModeCache,
    getFromEditModeCache,
    removeFromEditModeCache,
    addOverlay,
    updateOverlay,
    clearMarkersFromCache,
    requestOverlayReplacement,
    resetReplacement,
    showInfoPopupForOverlay,
    hideInfoPopup,
    closeAllUIElements,
    clearAllState,
  };
});
