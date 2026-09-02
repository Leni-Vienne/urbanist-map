import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, ref } from "vue";
import { buildImageUrl } from "@/utils/imageUrl";
import type {
  BackendOverlayData,
  LatLng,
  OverlayHistoryState,
  OverlayObject,
  OverlayPositionState,
  RuntimeOverlayData,
  TileOverlayData,
} from "@/types/index";

type OverlayDraft = Partial<
  Pick<
    OverlayObject,
    "caption" | "filename" | "imageUrl" | "history" | "redoStack" | "isTooBig" | "positionState"
  >
> & { base?: RuntimeOverlayData };

function restingPositionState(overlay: OverlayObject): OverlayPositionState {
  return overlay.hasPendingChanges === true ? "suggested" : "baseline";
}

function defaultCaption(overlay: OverlayObject): string | null {
  return overlay.hasPendingChanges === true &&
    overlay.suggestedCaption !== null &&
    overlay.suggestedCaption !== undefined
    ? overlay.suggestedCaption
    : overlay.baselineCaption;
}

function toRuntimeOverlayData(overlay: OverlayObject): RuntimeOverlayData {
  const {
    imageUrl: _imageUrl,
    history: _history,
    redoStack: _redoStack,
    isTooBig: _isTooBig,
    positionState: _positionState,
    ...data
  } = overlay;
  return data;
}

function materializeOverlay(data: RuntimeOverlayData): OverlayObject {
  const forceBackendUrl = data.status === "pending" || data.status === null;
  const imageUrl = data.filename.startsWith("data:")
    ? data.filename
    : buildImageUrl(data.filename, forceBackendUrl);
  return {
    ...data,
    imageUrl,
    history: [],
    redoStack: [],
    positionState: data.hasPendingChanges === true ? "suggested" : "baseline",
  };
}

function copyCorner(corner: LatLng): LatLng {
  return { lat: corner.lat, lng: corner.lng };
}

export const useOverlayStore = defineStore("overlay", () => {
  const persistedOverlays = ref<Record<string, BackendOverlayData>>({});
  const tileOverlays = ref<Record<string, TileOverlayData>>({});
  const selectedTileOverlay = ref<TileOverlayData | null>(null);
  const overlayDrafts = ref<Record<string, OverlayDraft>>({});
  const replacementOverlayId = ref<string | null>(null);

  function getOverlayById(overlayId: string): OverlayObject | null {
    const draft = overlayDrafts.value[overlayId];
    const data =
      persistedOverlays.value[overlayId] ??
      draft?.base ??
      tileOverlays.value[overlayId] ??
      (selectedTileOverlay.value?.id === overlayId ? selectedTileOverlay.value : undefined);
    if (!data) return null;
    const overlay = materializeOverlay(data);
    overlay.caption = defaultCaption(overlay);
    if (!draft) return overlay;
    const { base: _base, ...updates } = draft;
    return Object.assign(overlay, updates);
  }

  function getEffectiveOverlays(): Record<string, OverlayObject> {
    const ids = new Set([
      ...Object.keys(tileOverlays.value),
      ...Object.keys(persistedOverlays.value),
      ...Object.keys(overlayDrafts.value),
    ]);
    if (selectedTileOverlay.value) ids.add(selectedTileOverlay.value.id);
    const overlays: Record<string, OverlayObject> = {};
    for (const id of ids) {
      const overlay = getOverlayById(id);
      if (overlay) overlays[id] = overlay;
    }
    return overlays;
  }

  const liveOverlays = computed<Record<string, OverlayObject>>(getEffectiveOverlays);

  function addLocalOverlay(overlayId: string, overlay: OverlayObject) {
    overlayDrafts.value[overlayId] = {
      base: toRuntimeOverlayData(overlay),
      caption: overlay.caption,
      filename: overlay.filename,
      imageUrl: overlay.imageUrl,
      history: overlay.history,
      redoStack: overlay.redoStack,
      isTooBig: overlay.isTooBig,
      positionState: overlay.positionState,
    };
  }

  function updateOverlayDraft(overlayId: string, updates: OverlayDraft) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    let existing = overlayDrafts.value[overlayId];
    if (!existing) {
      existing = persistedOverlays.value[overlayId] ? {} : { base: toRuntimeOverlayData(overlay) };
    }
    overlayDrafts.value[overlayId] = {
      ...existing,
      ...updates,
    };
  }

  function hasFullOverlayData(overlayId: string): boolean {
    return Boolean(
      persistedOverlays.value[overlayId] || overlayDrafts.value[overlayId]?.base?.status === null,
    );
  }

  function updatePersistedOverlay(overlayId: string, updates: Partial<BackendOverlayData>) {
    const current = persistedOverlays.value[overlayId];
    if (!current) return;
    persistedOverlays.value[overlayId] = { ...current, ...updates };
  }

  function ingestBackendOverlay(data: BackendOverlayData, preserveDraft = true): OverlayObject {
    persistedOverlays.value[data.id] = data;
    if (!preserveDraft) {
      // oxlint-disable-next-line no-dynamic-delete
      delete overlayDrafts.value[data.id];
    }
    const overlay = getOverlayById(data.id);
    if (!overlay) throw new Error(`Failed to cache overlay ${data.id}`);
    return overlay;
  }

  function replaceTileOverlays(overlays: ReadonlyMap<string, TileOverlayData>): void {
    tileOverlays.value = Object.fromEntries(overlays);
  }

  function retainSelectedTileOverlay(overlayId: string): void {
    selectedTileOverlay.value = tileOverlays.value[overlayId] ?? null;
  }

  function clearSelectedTileOverlay(): void {
    selectedTileOverlay.value = null;
  }

  function clearPendingChangeRequest(overlayId: string): void {
    const overlay = getOverlayById(overlayId);
    const persisted = persistedOverlays.value[overlayId];
    if (!overlay || !persisted) return;
    const defaultBeforeRefresh = overlay.suggestedCaption ?? overlay.baselineCaption;
    const captionWasUntouched = overlay.caption === defaultBeforeRefresh;
    updatePersistedOverlay(overlayId, {
      hasPendingChanges: false,
      suggestedCorners: undefined,
      suggestedCaption: undefined,
    });
    const nextState = overlay.positionState === "staged" ? "staged" : "baseline";
    const draftUpdate: OverlayDraft = { positionState: nextState };
    if (captionWasUntouched) draftUpdate.caption = overlay.baselineCaption;
    updateOverlayDraft(overlayId, draftUpdate);
    if (
      overlay.history.length === 1 &&
      overlay.redoStack.length === 0 &&
      overlay.baselineCorners?.length === 4
    ) {
      resetHistoryBaseline(overlayId, overlay.baselineCorners);
    }
  }

  function commitHistory(overlayId: string, history: OverlayHistoryState[]) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    updateOverlayDraft(overlayId, {
      history,
      redoStack: [],
      positionState: history.length > 1 ? "staged" : restingPositionState(overlay),
    });
  }

  function resetHistoryBaseline(overlayId: string, corners: LatLng[]) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    const history =
      corners.length === 4
        ? [
            {
              corners: corners.map(copyCorner),
              imageUrl: overlay.imageUrl,
            },
          ]
        : [];
    updateOverlayDraft(overlayId, {
      history,
      redoStack: [],
      positionState:
        overlay.positionState === "staged" ? restingPositionState(overlay) : overlay.positionState,
    });
  }

  function undoHistory(overlayId: string): OverlayHistoryState | null {
    const overlay = getOverlayById(overlayId);
    if (!overlay || overlay.history.length <= 1) return null;
    const history = overlay.history.slice(0, -1);
    const current = overlay.history.at(-1);
    const target = history.at(-1);
    if (!current || !target) return null;
    updateOverlayDraft(overlayId, {
      history,
      redoStack: [...overlay.redoStack, current],
      positionState: history.length === 1 ? restingPositionState(overlay) : overlay.positionState,
    });
    return target;
  }

  function redoHistory(overlayId: string): OverlayHistoryState | null {
    const overlay = getOverlayById(overlayId);
    const target = overlay?.redoStack.at(-1);
    if (!overlay || !target) return null;
    updateOverlayDraft(overlayId, {
      history: [...overlay.history, target],
      redoStack: overlay.redoStack.slice(0, -1),
      positionState: "staged",
    });
    return target;
  }

  function removeOverlay(overlayId: string): void {
    // oxlint-disable-next-line no-dynamic-delete
    delete persistedOverlays.value[overlayId];
    // oxlint-disable-next-line no-dynamic-delete
    delete tileOverlays.value[overlayId];
    // oxlint-disable-next-line no-dynamic-delete
    delete overlayDrafts.value[overlayId];
    if (selectedTileOverlay.value?.id === overlayId) clearSelectedTileOverlay();
  }

  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
  }

  function resetReplacement() {
    replacementOverlayId.value = null;
  }

  function clearLiveOverlays() {
    persistedOverlays.value = {};
    tileOverlays.value = {};
    clearSelectedTileOverlay();
    overlayDrafts.value = {};
  }

  function clearAllState() {
    clearLiveOverlays();
    resetReplacement();
  }

  return {
    persistedOverlays,
    tileOverlays,
    selectedTileOverlay,
    overlayDrafts,
    liveOverlays,
    replacementOverlayId,
    getOverlayById,
    hasFullOverlayData,
    addLocalOverlay,
    updateOverlayDraft,
    updatePersistedOverlay,
    ingestBackendOverlay,
    replaceTileOverlays,
    retainSelectedTileOverlay,
    clearSelectedTileOverlay,
    clearPendingChangeRequest,
    commitHistory,
    resetHistoryBaseline,
    undoHistory,
    redoHistory,
    removeOverlay,
    requestOverlayReplacement,
    resetReplacement,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOverlayStore, import.meta.hot));
}
