import { watch } from "vue";
import type { LngLatBounds, Map as MaplibreMap } from "maplibre-gl";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useFocusStore } from "@/stores/focusStore";
import { getMapOrNull } from "@/services/core/map";
import { shouldDisplayOverlay } from "@/services/overlay/visibility";
import type { OverlayObject } from "@/types/index";
import { activeFilters } from "@/services/core/filters";
import { createOverlayMarker, updateMarkerPosition } from "@/services/overlay/markers";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { isValidQuad, sameCorners } from "@/services/overlay/transform";
import * as registry from "@/services/overlay/mapLayers";
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import { getMapSessionSnapshot } from "@/services/map/mapSessionState";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

// Whether an overlay's source data intersects the viewport at its store-derived display position.
// Keying membership on the resolved position keeps an open change request's
// image alive at its suggested position even when the approved footprint sits off-screen.
function resolvedCornersInBounds(source: OverlayObject, bounds: LngLatBounds): boolean {
  const corners = resolveOverlayCorners(source);
  return isValidQuad(corners) && cornersIntersectBounds(corners, bounds);
}

// Converge an existing overlay's image + marker to its desired store-derived display. The desired
// image bytes are the canonical imageUrl and the desired corners come from store state. Both are
// compared against what was last applied (never a GL read-back). Returns true
// when it moved something, so the caller can refresh the active edit session's handles once.
// Runs in edit and moderation: resolveOverlayCorners resolves the edit-session position or the
// moderation change-request preview position from store state. Gesture-owned entries never reach here.
function convergeOverlayDisplay(overlayObject: OverlayObject): boolean {
  const id = overlayObject.id;
  const handle = registry.getImageHandle(id);
  if (!handle) return false;

  const desiredCorners = resolveOverlayCorners(overlayObject);
  if (!isValidQuad(desiredCorners)) return false;

  // Image bytes changed (crop apply, undo/redo across a crop): rebuild the source at the desired
  // corners, which also records them as applied.
  if (overlayObject.imageUrl !== handle.imageUrl) {
    registry.replaceOverlayImageSource(id, overlayObject.imageUrl, desiredCorners);
    updateMarkerPosition(overlayObject);
    return true;
  }

  // Position changed (undo/redo/toggle, backend field update, mode switch): move the image.
  if (!sameCorners(desiredCorners, registry.getLastAppliedCorners(id))) {
    registry.setOverlayImageCorners(id, desiredCorners);
    updateMarkerPosition(overlayObject);
    return true;
  }

  return false;
}

/** Own the scheduled reconciliation and teardown work for one mounted map. */
export function createViewportRenderLoop(target: MaplibreMap, onDisplayChanged: () => void) {
  let renderLoopRafId: number | null = null;
  let stopped = false;
  // Drains in batches of 10 per frame to spread bulk teardown (e.g. Edit -> View) across frames.
  const destructionQueue = createRafBatchQueue<null>((_, id) => registry.clearEntry(id), 10);

  // Coalesce camera, style and state changes into one pass over the latest state per frame.
  function run(): void {
    if (stopped || renderLoopRafId !== null) return;
    renderLoopRafId = requestAnimationFrame(() => {
      renderLoopRafId = null;
      if (getMapOrNull() !== target) return;
      reconcileOverlayExistence(target.getBounds());
    });
  }

  function stop(): void {
    stopped = true;
    if (renderLoopRafId !== null) {
      cancelAnimationFrame(renderLoopRafId);
      renderLoopRafId = null;
    }
    destructionQueue.clear();
  }

  function queueForDestruction(id: string): void {
    destructionQueue.enqueue(id, null);
  }

  /**
   * Single existence pass: for every overlay the map could show, decide whether its image/marker
   * should exist right now, and create or destroy to match. In edit and moderation mode it also
   * converges each existing image/marker to its desired store-derived position via
   * convergeOverlayDisplay.
   *
   * Candidate ids come from every set that can want an overlay on the map:
   *   - tileOverlays: approved overlays represented by MapLibre's renderable in-view tiles.
   *   - active map session: pending + session change-request overlays (edit/moderation only).
   *   - liveOverlays(status === null): local/unsaved overlays.
   *   - current registry ids: so entries that left every live set get destroyed.
   *
   * Tile-managed approved overlays use their renderable tile as the spatial gate. Session, selected,
   * and local overlays use mode/user visibility, map filters, and their resolved corners.
   */
  // oxlint-disable-next-line complexity
  function reconcileOverlayExistence(bounds: LngLatBounds): void {
    const overlayStore = useOverlayStore();
    const uiStore = useUiStore();
    const authStore = useAuthStore();
    const mode = uiStore.mode;
    const userId = authStore.user?.id;
    // Edit/moderation show a clickable status pin per overlay, and converge each image onto its
    // store-derived position. View mode relies on the overlay-footprints MVT layer for clicks (so
    // approved images get no DOM marker) and leaves approved overlays at their baseline footprint.
    const isSessionMode = mode !== "view";
    let handlesNeedSync = false;

    // Below the threshold the map holds no overlay content: tear down every entry and skip the pass.
    // Crossing back up re-creates images and markers from the store and the tile cache.
    if (target.getZoom() < getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS)) {
      for (const id of registry.getEntryIds()) {
        if (!registry.isGestureOwned(id)) queueForDestruction(id);
      }
      return;
    }

    const tileManaged = overlayStore.tileOverlays;
    const mapSession = getMapSessionSnapshot();
    const sessionOverlayIds =
      isSessionMode && mapSession?.mode === mode ? mapSession.overlayIds : [];
    const sessionOverlayIdSet = new Set(sessionOverlayIds);

    const candidateIds = new Set<string>();
    for (const id of Object.keys(tileManaged)) candidateIds.add(id);
    for (const id of sessionOverlayIds) candidateIds.add(id);
    const selectedOverlayId = useFocusStore().selectedOverlayId;
    if (selectedOverlayId) candidateIds.add(selectedOverlayId);
    for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
      if (overlay.status === null) candidateIds.add(id);
    }
    for (const id of registry.getEntryIds()) candidateIds.add(id);

    for (const id of candidateIds) {
      // Mid-gesture the GL image is deliberately ahead of the store; leave those overlays alone.
      if (registry.isGestureOwned(id)) continue;

      const liveObject = overlayStore.liveOverlays[id];
      const hasImage = registry.getImageHandle(id) !== null;
      const hasMarker = registry.getMarker(id) !== null;

      const tileData = tileManaged[id];
      const isTileManaged = tileData !== undefined;
      const isStoreManaged =
        liveObject?.status === null || sessionOverlayIdSet.has(id) || id === selectedOverlayId;
      const desired =
        isTileManaged ||
        (liveObject !== undefined &&
          isStoreManaged &&
          shouldDisplayOverlay(liveObject, mode, userId) &&
          resolvedCornersInBounds(liveObject, bounds));

      if (desired) {
        const overlayObject = tileData ? overlayStore.getOverlayById(id) : liveObject;
        if (!overlayObject) continue;
        destructionQueue.delete(id);
        if (isSessionMode && !hasMarker) {
          createOverlayMarker(overlayObject);
        }
        if (!hasImage) {
          registry.createOverlayImage(
            overlayObject.id,
            overlayObject.imageUrl,
            resolveOverlayCorners(overlayObject),
          );
        } else if (isSessionMode && convergeOverlayDisplay(overlayObject)) {
          handlesNeedSync = true;
        }
      } else if (hasImage || hasMarker) {
        queueForDestruction(id);
      }
    }

    if (handlesNeedSync) onDisplayChanged();
  }

  return { run, stop };
}

/** Observe state changes instead of requiring writers to request map rendering. */
export function watchOverlayReconciliation(renderOverlays: () => void): () => void {
  return watch(
    [
      activeFilters,
      // Includes tile arrivals and local overlays outside the retained edit/moderation session.
      () => useOverlayStore().liveOverlays,
      () => useFocusStore().selectedOverlayId,
      () => useUiStore().mode,
      () => useChangeRequestStore().previewState,
      () => {
        const session = getMapSessionSnapshot();
        if (!session || session.mode !== useUiStore().mode) return null;
        return {
          session,
          projects: session.projectIds.map((id) =>
            useProjectStore().getMapProjectById(id, session.mode),
          ),
        };
      },
    ],
    renderOverlays,
  );
}
