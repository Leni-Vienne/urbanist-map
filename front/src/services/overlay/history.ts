import type { NormalizedRect, OverlayHistoryState } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";

type Corner = { lat: number; lng: number };

// Build a history step, cloning corners so later mutations don't alias a stored step.
export function makeHistoryState(
  corners: Corner[],
  imageUrl: string,
  cropRect?: NormalizedRect,
): OverlayHistoryState {
  return { corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })), imageUrl, cropRect };
}

// Sync the overlay's live image position into pendingModificationsStore as a corners delta.
// No-op for new (status null) overlays, whose position lives only in history; only submitted
// overlays track a delta. Call after any change to the live position (edit, undo, redo).
export function syncPendingOverlayCorners(id: string): void {
  const pendingModsStore = usePendingModificationsStore();
  const mapStore = useMapStore();

  if (mapStore.mode !== "edit") return;

  const overlay = useOverlayStore().liveOverlays[id];
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

// Commit one overlay edit (move / resize / crop): push a history step for the live image position
// and sync the pending change-request corners delta. Seeds an empty history with the backend
// corners first. Returns early without committing when the position matches the last step.
export function commitOverlayEdit(id: string, cropRect?: NormalizedRect): void {
  const overlayStore = useOverlayStore();
  const overlay = overlayStore.liveOverlays[id];
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
    baseHistory = [makeHistoryState(overlay.corners, overlay.imageUrl)];
  }

  if (baseHistory.length > 0) {
    const lastState = baseHistory.at(-1);
    if (JSON.stringify(currentState) === JSON.stringify(lastState)) {
      return;
    }
  }

  overlayStore.commitHistory(id, [...baseHistory, currentState]);

  syncPendingOverlayCorners(id);
}
