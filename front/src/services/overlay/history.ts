import type { NormalizedRect, OverlayHistoryState, LatLng } from "@/types/index";
import { useOverlayStore } from "@/stores/overlayStore";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import { isValidQuad, getEditModeRestingCorners } from "@/services/overlay/transform";

// Build a history step, cloning corners so later mutations don't alias a stored step.
export function makeHistoryState(
  corners: LatLng[],
  imageUrl: string,
  cropRect?: NormalizedRect,
): OverlayHistoryState {
  return { corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })), imageUrl, cropRect };
}

// Commit one overlay edit (move / resize / crop): push a history step for the live image position.
// Seeds an empty history with the overlay's resting position first. Returns early without
// committing when the position matches the last step.
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

  // Seed empty history with the overlay's resting position so the first undo returns there.
  let baseHistory = overlay.history;
  if (baseHistory.length === 0) {
    const restingCorners = getEditModeRestingCorners(overlay);
    if (isValidQuad(restingCorners)) {
      baseHistory = [makeHistoryState(restingCorners, overlay.imageUrl)];
    }
  }

  if (baseHistory.length > 0) {
    const lastState = baseHistory.at(-1);
    if (JSON.stringify(currentState) === JSON.stringify(lastState)) {
      return;
    }
  }

  overlayStore.commitHistory(id, [...baseHistory, currentState]);
}
