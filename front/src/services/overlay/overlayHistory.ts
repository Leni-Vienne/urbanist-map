import type { NormalizedRect, OverlayHistoryState, OverlayObject } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerTooltip } from "@/services/map/markers";
import { isValidQuad } from "@/services/overlay/overlayTransform";
import { getOverlayImageCorners } from "@/services/overlay/overlayImageLayer";

type Corner = { lat: number; lng: number };

// Build a history step, cloning corners so later mutations don't alias a stored step.
export function makeHistoryState(
  corners: Corner[],
  imageUrl: string,
  cropRect?: NormalizedRect,
): OverlayHistoryState {
  return { corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })), imageUrl, cropRect };
}

// Corners to (re)create and hit-test the overlay IMAGE at, biased toward the remembered/intended
// position: history > backend corners > live image. In view mode, approved overlays render at
// their backend corners but keep history, so edit mode can restore in-progress edits.
// Deliberately the inverse of resolveOverlayMarkerCorners, which places the marker on the LIVE
// image and so prefers the live position first; both share isValidQuad.
export function resolveOverlayRenderCorners(overlayObject: OverlayObject) {
  const mapStore = useMapStore();
  const ignoreHistory = mapStore.mode === "view" && overlayObject.status === "approved";

  if (!ignoreHistory && overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1)?.corners;
    if (isValidQuad(lastCorners)) return lastCorners;
  }

  // Skip all-zero corners, which indicates a freshly created overlay with no position yet
  const stored = overlayObject.corners;
  const isUnplaced = stored.every((c) => c.lat === 0 && c.lng === 0);
  if (!isUnplaced && isValidQuad(stored)) return stored;

  return getOverlayImageCorners(overlayObject.id);
}

// Record the current image position as a change-request delta. No-op for new (status null)
// overlays, whose position lives only in history; only submitted overlays track a delta.
export function recordOverlayModification(id: string): void {
  const pendingModsStore = usePendingModificationsStore();
  const mapStore = useMapStore();

  if (mapStore.mode !== "edit") return;

  const overlay = useOverlayStore().overlays[id];
  if (!overlay || overlay.status === null) return;

  const corners = getOverlayImageCorners(id);
  if (!corners) return;

  const mappedCorners = corners.map((corner) => ({ lat: corner.lat, lng: corner.lng }));

  pendingModsStore.saveCornersChange(
    id,
    overlay.projectId ?? null,
    mappedCorners,
    overlay.corners,
    overlay.status,
  );
}

export function saveToHistory(id: string, cropRect?: NormalizedRect): void {
  const overlayStore = useOverlayStore();
  const overlay = overlayStore.overlays[id];
  if (!overlay) return;

  const currentCorners = getOverlayImageCorners(id);
  if (!currentCorners) return;
  // A move/resize keeps the same image, so carry the prior step's crop window forward; a crop
  // passes its new window explicitly so the next crop composes onto the right region.
  const effectiveRect = cropRect ?? overlay.history.at(-1)?.cropRect;
  const currentState = makeHistoryState(currentCorners, overlay.imageUrl, effectiveRect);

  // Seed empty history with the backend corners so the first undo has a base state.
  let baseHistory = overlay.history;
  if (baseHistory.length === 0 && overlay.corners.length === 4) {
    if (!overlay.corners.every((c) => c.lat === 0 && c.lng === 0)) {
      baseHistory = [makeHistoryState(overlay.corners, overlay.imageUrl)];
    }
  }

  if (baseHistory.length > 0) {
    const lastState = baseHistory.at(-1);
    if (JSON.stringify(currentState) === JSON.stringify(lastState)) {
      return;
    }
  }

  overlayStore.commitHistory(id, [...baseHistory, currentState]);

  recordOverlayModification(id);
  updateMarkerTooltip(overlay);
}
