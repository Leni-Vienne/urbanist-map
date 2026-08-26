import { watch } from "vue";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useFocusStore } from "@/stores/focusStore";
import { getMap, getMapOrNull } from "@/services/core/map";
import {
  isOverlayVisible,
  matchesMapFilters,
  shouldDisplayOverlay,
} from "@/services/overlay/visibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import { activeFilters } from "@/services/core/filters";
import { createOverlayMarker, updateMarkerPosition } from "@/services/overlay/markers";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { getApprovedOverlayDataFromTiles } from "@/services/map/tiles/approvedOverlayCache";
import { isValidQuad, sameCorners } from "@/services/overlay/transform";
import * as registry from "@/services/overlay/mapLayers";
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import { getMapSessionSnapshot } from "@/services/map/mapSessionState";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Current viewport padded by 10% per axis, so content just past the edge isn't destroyed only to
// be re-created on the next small pan.
function getPaddedViewportBounds(): ViewportBounds {
  const mlBounds = getMap().getBounds();
  const sw = mlBounds.getSouthWest();
  const ne = mlBounds.getNorthEast();
  const latPad = (ne.lat - sw.lat) * 0.1;
  const lngPad = (ne.lng - sw.lng) * 0.1;
  return {
    north: Math.min(90, ne.lat + latPad),
    south: Math.max(-90, sw.lat - latPad),
    east: ne.lng + lngPad,
    west: sw.lng - lngPad,
  };
}

let renderLoopRafId: number | null = null;

/**
 * Coalesces repeated calls into a single run on the next animation frame.
 * The loop reads live map state, so collapsing same-frame calls is safe and
 * avoids redundant work when several triggers fire together (page load,
 * style switch, or a prune + full render within one viewport refresh).
 */
export function runViewportRenderLoop(): void {
  if (renderLoopRafId !== null) return;
  renderLoopRafId = requestAnimationFrame(() => {
    renderLoopRafId = null;
    runViewportRenderLoopNow();
  });
}

/**
 * Drop the pending reconcile and the queued teardown batches, so a frame scheduled against the
 * outgoing map cannot run once it is gone. Store writers may keep scheduling; the pass they get is
 * the next map's.
 */
export function stopViewportRenderLoop(): void {
  if (renderLoopRafId !== null) {
    cancelAnimationFrame(renderLoopRafId);
    renderLoopRafId = null;
  }
  destructionQueue.clear();
}

function runViewportRenderLoopNow(): void {
  // Scheduled work can survive into a frame where MapView has already unmounted.
  if (!getMapOrNull()) return;

  reconcileOverlayExistence(getPaddedViewportBounds());
}

// Drains in batches of 10 per frame to keep bulk teardown (e.g. Edit -> View) off the main thread.
// Destruction is cheaper than creation, so the batch can be larger than the init queue.
const destructionQueue = createRafBatchQueue<null>((_, id) => registry.clearEntry(id), 10);

function queueForDestruction(id: string): void {
  destructionQueue.enqueue(id, null);
}

// Whether an overlay's source data intersects the viewport at its store-derived display position.
// Keying membership on the resolved position keeps an open change request's
// image alive at its suggested position even when the approved footprint sits off-screen.
function resolvedCornersInBounds(
  source: OverlayObject | OverlayData,
  bounds: ViewportBounds,
): boolean {
  const corners = resolveOverlayCorners(source);
  return corners !== null && cornersIntersectBounds(corners, bounds);
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

/**
 * Single existence pass: for every overlay the map could show, decide whether its image/marker
 * should exist right now, and create or destroy to match. In edit and moderation mode it also
 * converges each existing image/marker to its desired store-derived position via
 * convergeOverlayDisplay.
 *
 * Candidate ids come from every set that can want an overlay on the map:
 *   - approvedOverlayDataCache: approved overlays vetted by tile sync (filters + viewport applied).
 *   - active map session: pending + session change-request overlays (edit/moderation only).
 *   - liveOverlays(status === null): local/unsaved overlays.
 *   - current registry ids: so entries that left every live set get destroyed.
 *
 * Desired existence = zoom ≥ MIN_ZOOM_FOR_OVERLAYS ∧ mode/user visibility ∧ map filters ∧ resolved
 * corners intersect bounds; local overlays are exempt from the bounds test (only explicit deletion,
 * a mode switch or the zoom gate removes them). An overlay the tile sync rejected on a user filter
 * is never desired, whichever data source resolves it.
 */
// oxlint-disable-next-line complexity
function reconcileOverlayExistence(bounds: ViewportBounds): void {
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
  if (getMap().getZoom() < getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS)) {
    for (const id of registry.getEntryIds()) {
      if (!registry.isGestureOwned(id)) queueForDestruction(id);
    }
    return;
  }

  const tileManaged = getApprovedOverlayDataFromTiles();
  const mapSession = getMapSessionSnapshot();
  const sessionOverlayIds = isSessionMode && mapSession?.mode === mode ? mapSession.overlayIds : [];

  const candidateIds = new Set<string>();
  for (const id of tileManaged.keys()) candidateIds.add(id);
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

    // Local/unsaved overlay: bounds-exempt, gated only on visibility + filters.
    if (liveObject?.status === null) {
      if (!isValidQuad(liveObject.baselineCorners)) continue;
      if (shouldDisplayOverlay(liveObject, mode, userId)) {
        destructionQueue.delete(id);
        if (!hasImage) {
          registry.createOverlayImage(liveObject, resolveOverlayCorners(liveObject));
        } else if (isSessionMode && convergeOverlayDisplay(liveObject)) handlesNeedSync = true;
        if (!hasMarker) createOverlayMarker(liveObject);
      } else if (hasImage || hasMarker) {
        queueForDestruction(id);
      }
      continue;
    }

    // Approved + tile-delivered: cache membership already applied filters and viewport.
    const tileData = tileManaged.get(id);
    const isTileManaged = tileData !== undefined;
    let desired = isTileManaged;
    if (!isTileManaged) {
      // Fall back to the canonical store object when its resolved display position differs from the
      // approved tile footprint.
      const data = liveObject ?? null;
      desired =
        data !== null &&
        isOverlayVisible(liveObject ?? data, mode, userId) &&
        matchesMapFilters(liveObject ?? data, mode) &&
        resolvedCornersInBounds(liveObject ?? data, bounds);
    }

    if (desired) {
      const overlayObject = tileData ? overlayStore.ingestTileOverlay(tileData) : liveObject;
      if (!overlayObject) continue;
      destructionQueue.delete(id);
      if (isSessionMode && !hasMarker) {
        createOverlayMarker(overlayObject);
      }
      if (!hasImage) {
        registry.createOverlayImage(overlayObject, resolveOverlayCorners(overlayObject));
      } else if (isSessionMode && convergeOverlayDisplay(overlayObject)) {
        handlesNeedSync = true;
      }
    } else if (hasImage || hasMarker) {
      queueForDestruction(id);
    }
  }

  if (handlesNeedSync) registry.runEditHandleSync();
}

/** Install the map-instance scheduler used by overlay store writers. */
export function installViewportRenderLoop(): () => void {
  return registry.registerOverlayReconcileScheduler(runViewportRenderLoop);
}

export function watchOverlayReconciliation(): () => void {
  const stopFilterWatch = watch(activeFilters, runViewportRenderLoop);

  // A moderation change-request preview resolves position from previewState; a change to it (set,
  // toggle, clear) must re-run convergence so the previewed overlay follows or returns to baseline.
  const stopPreviewWatch = watch(
    () => useChangeRequestStore().previewState,
    () => {
      runViewportRenderLoop();
    },
  );
  return function stopOverlayReconciliationWatchers(): void {
    stopPreviewWatch();
    stopFilterWatch();
  };
}
