import { useSubmissionStore } from "@/stores/submissionStore";
import { defineStore, acceptHMRUpdate } from "pinia";
import { computed, onScopeDispose, reactive, ref } from "vue";
import { trpc } from "@/client";
import { useAuthStore } from "@/stores/authStore";
import { overlayWireToData } from "@/utils/typeFactories";
import { buildImageUrl } from "@/utils/imageUrl";
import {
  getEditModeDefaultCaption,
  getEditModeRestingCorners,
} from "@/services/overlay/defaultState";
import { isValidQuad } from "@/services/overlay/transform";
import type {
  BackendOverlayData,
  LatLng,
  NormalizedRect,
  OverlayHistoryState,
  OverlayObject,
  RuntimeOverlayData,
  TileOverlayData,
} from "@/types/index";

type OverlayDraft = Partial<
  Pick<OverlayObject, "caption" | "history" | "redoStack" | "showApprovedPosition">
> & {
  base?: RuntimeOverlayData;
};

function makeHistoryState(
  corners: LatLng[],
  imageUrl: string,
  cropRect?: NormalizedRect,
): OverlayHistoryState {
  return { corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })), imageUrl, cropRect };
}

function toRuntimeOverlayData(overlay: OverlayObject): RuntimeOverlayData {
  const {
    imageUrl: _imageUrl,
    history: _history,
    redoStack: _redoStack,
    showApprovedPosition: _showApprovedPosition,
    ...data
  } = overlay;
  return data;
}

export const useOverlayStore = defineStore("overlay", () => {
  const submissionStore = useSubmissionStore();
  const authStore = useAuthStore();
  const pendingDetails = new Map<
    string,
    { controller: AbortController; promise: Promise<OverlayObject | null> }
  >();
  const persistedOverlays = ref<Record<string, BackendOverlayData>>({});
  const tileOverlays = ref<Record<string, TileOverlayData>>({});
  const selectedTileOverlay = ref<TileOverlayData | null>(null);
  const overlayDrafts = ref<Record<string, OverlayDraft>>({});
  // Persist through map remounts and source rebuilds; reset with the user's overlay state.
  const frontOverlayIds = reactive(new Set<string>());
  const overlayOpacities = reactive(new Map<string, number>());

  function getOverlayById(overlayId: string): OverlayObject | null {
    const draft = overlayDrafts.value[overlayId];
    const data =
      persistedOverlays.value[overlayId] ??
      draft?.base ??
      tileOverlays.value[overlayId] ??
      (selectedTileOverlay.value?.id === overlayId ? selectedTileOverlay.value : undefined);
    if (!data) return null;
    const history = draft?.history ?? [];
    return {
      ...data,
      caption: draft?.caption === undefined ? getEditModeDefaultCaption(data) : draft.caption,
      history,
      redoStack: draft?.redoStack ?? [],
      showApprovedPosition: draft?.showApprovedPosition ?? false,
      imageUrl:
        history.at(-1)?.imageUrl ??
        (data.filename.startsWith("data:")
          ? data.filename
          : buildImageUrl(data.filename, data.status === "pending" || data.status === null)),
    };
  }

  function getEffectiveOverlays() {
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
    if (submissionStore.isSubmitting) return;
    overlayDrafts.value[overlayId] = {
      base: toRuntimeOverlayData(overlay),
      caption: overlay.caption,
      history: overlay.history,
      redoStack: overlay.redoStack,
      showApprovedPosition: overlay.showApprovedPosition,
    };
  }

  function updateOverlayDraft(overlayId: string, updates: OverlayDraft) {
    if (submissionStore.isSubmitting) return;
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    const existing =
      overlayDrafts.value[overlayId] ??
      (persistedOverlays.value[overlayId] ? {} : { base: toRuntimeOverlayData(overlay) });
    overlayDrafts.value[overlayId] = {
      ...existing,
      ...updates,
    };
  }

  async function fetchOverlay(
    overlayId: string,
    signal: AbortSignal,
  ): Promise<OverlayObject | null> {
    const epoch = authStore.getSessionEpoch();
    const userId = authStore.user?.id;
    const original = persistedOverlays.value[overlayId];
    const result = await trpc.overlay.getOverlay.query({ id: overlayId }, { signal });
    if (signal.aborted || epoch !== authStore.getSessionEpoch() || userId !== authStore.user?.id)
      return null;
    // Keep a receipt or moderation update that arrived after this request started.
    const current = persistedOverlays.value[overlayId];
    if (current && current !== original && current.version >= result.version)
      return getOverlayById(overlayId);
    return ingestBackendOverlay(overlayWireToData(result));
  }

  async function loadOverlay(overlayId: string, force = false): Promise<OverlayObject | null> {
    if (force) {
      pendingDetails.get(overlayId)?.controller.abort();
      pendingDetails.delete(overlayId);
    }
    if (
      (!force && persistedOverlays.value[overlayId]) ||
      overlayDrafts.value[overlayId]?.base?.status === null
    )
      return getOverlayById(overlayId);
    let request = pendingDetails.get(overlayId);
    if (!request) {
      const controller = new AbortController();
      request = { controller, promise: fetchOverlay(overlayId, controller.signal) };
      pendingDetails.set(overlayId, request);
    }
    try {
      return await request.promise;
    } catch (error) {
      if (request.controller.signal.aborted) return null;
      throw error;
    } finally {
      if (pendingDetails.get(overlayId) === request) pendingDetails.delete(overlayId);
    }
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
    const captionWasUntouched = overlay.caption === getEditModeDefaultCaption(overlay);
    updatePersistedOverlay(overlayId, {
      ownProposal: undefined,
    });
    const draftUpdate: OverlayDraft = { showApprovedPosition: false };
    if (captionWasUntouched) draftUpdate.caption = overlay.baselineCaption;
    updateOverlayDraft(overlayId, draftUpdate);
    if (
      overlay.history.length === 1 &&
      overlay.redoStack.length === 0 &&
      overlay.baselineCorners?.length === 4
    ) {
      resetHistoryBaseline(overlayId);
    }
  }

  // Commit a completed gesture or crop. Seed the first undo with the untouched image and the
  // chosen approved/suggested position; subsequent moves carry the active crop window forward.
  function commitOverlayEdit(
    overlayId: string,
    corners: LatLng[],
    image?: Pick<OverlayHistoryState, "imageUrl" | "cropRect">,
  ) {
    const overlay = getOverlayById(overlayId);
    if (!overlay || !isValidQuad(corners)) return;
    const current = makeHistoryState(
      corners,
      image?.imageUrl ?? overlay.imageUrl,
      image?.cropRect ?? overlay.history.at(-1)?.cropRect,
    );
    let history = overlay.history;
    if (history.length === 0) {
      const resting = getEditModeRestingCorners(overlay);
      if (isValidQuad(resting)) history = [makeHistoryState(resting, overlay.imageUrl)];
    }
    if (JSON.stringify(current) === JSON.stringify(history.at(-1))) return;
    updateOverlayDraft(overlayId, {
      history: [...history, current],
      redoStack: [],
    });
  }

  function resetHistoryBaseline(overlayId: string) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    const corners = getEditModeRestingCorners(overlay);
    const history = isValidQuad(corners)
      ? [makeHistoryState(corners, overlay.history[0]?.imageUrl ?? overlay.imageUrl)]
      : [];
    updateOverlayDraft(overlayId, {
      history,
      redoStack: [],
    });
  }

  function undoHistory(overlayId: string): OverlayHistoryState | null {
    if (submissionStore.isSubmitting) return null;
    const overlay = getOverlayById(overlayId);
    if (!overlay || overlay.history.length <= 1) return null;
    const history = overlay.history.slice(0, -1);
    const current = overlay.history.at(-1);
    const target = history.at(-1);
    if (!current || !target) return null;
    updateOverlayDraft(overlayId, {
      history,
      redoStack: [...overlay.redoStack, current],
    });
    return target;
  }

  function redoHistory(overlayId: string): OverlayHistoryState | null {
    if (submissionStore.isSubmitting) return null;
    const overlay = getOverlayById(overlayId);
    const target = overlay?.redoStack.at(-1);
    if (!overlay || !target) return null;
    updateOverlayDraft(overlayId, {
      history: [...overlay.history, target],
      redoStack: overlay.redoStack.slice(0, -1),
    });
    return target;
  }

  function removeOverlay(overlayId: string): void {
    pendingDetails.get(overlayId)?.controller.abort();
    pendingDetails.delete(overlayId);
    // oxlint-disable-next-line no-dynamic-delete
    delete persistedOverlays.value[overlayId];
    // oxlint-disable-next-line no-dynamic-delete
    delete tileOverlays.value[overlayId];
    // oxlint-disable-next-line no-dynamic-delete
    delete overlayDrafts.value[overlayId];
    if (selectedTileOverlay.value?.id === overlayId) clearSelectedTileOverlay();
    frontOverlayIds.delete(overlayId);
    overlayOpacities.delete(overlayId);
  }

  function clearLiveOverlays() {
    persistedOverlays.value = {};
    tileOverlays.value = {};
    clearSelectedTileOverlay();
    overlayDrafts.value = {};
  }

  function clearAllState() {
    for (const request of pendingDetails.values()) request.controller.abort();
    pendingDetails.clear();
    clearLiveOverlays();
    frontOverlayIds.clear();
    overlayOpacities.clear();
  }

  onScopeDispose(clearAllState);

  return {
    persistedOverlays,
    tileOverlays,
    overlayDrafts,
    liveOverlays,
    frontOverlayIds,
    overlayOpacities,
    getOverlayById,
    loadOverlay,
    addLocalOverlay,
    updateOverlayDraft,
    updatePersistedOverlay,
    ingestBackendOverlay,
    replaceTileOverlays,
    retainSelectedTileOverlay,
    clearSelectedTileOverlay,
    clearPendingChangeRequest,
    commitOverlayEdit,
    resetHistoryBaseline,
    undoHistory,
    redoHistory,
    removeOverlay,
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOverlayStore, import.meta.hot));
}
