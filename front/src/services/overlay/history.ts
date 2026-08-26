import type { NormalizedRect, OverlayHistoryState, LatLng } from "@/types/index";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import {
  getImageHandle,
  deriveOverlayFilename,
  isGestureOwned,
  scheduleOverlayReconcile,
} from "@/services/overlay/mapLayers";
import { isValidQuad } from "@/services/overlay/transform";
import { getEditModeRestingCorners } from "@/services/overlay/positionState";
import { isTypingTarget } from "@/utils/keyboard";
import { useUiStore } from "@/stores/uiStore";

// Build a history step, cloning corners so later mutations don't alias a stored step.
export function makeHistoryState(
  corners: LatLng[],
  imageUrl: string,
  cropRect?: NormalizedRect,
): OverlayHistoryState {
  return { corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })), imageUrl, cropRect };
}

// Commit one completed overlay edit (move / resize / crop) as a history step.
// Seeds an empty history with the overlay's resting position first. Returns early without
// committing when the position matches the last step.
export function commitOverlayEdit(
  id: string,
  currentCorners: LatLng[],
  cropRect?: NormalizedRect,
): void {
  const overlayStore = useOverlayStore();
  const overlay = overlayStore.liveOverlays[id];
  if (!overlay) return;

  if (!isValidQuad(currentCorners)) return;
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

export function undo() {
  applyHistoryAction("undo");
}

export function redo() {
  applyHistoryAction("redo");
}

function applyHistoryAction(action: "undo" | "redo") {
  if (useUiStore().mode !== "edit") return;

  const overlayStore = useOverlayStore();

  const id = useFocusStore().selectedOverlayId;
  if (!id || !getImageHandle(id) || isGestureOwned(id)) return;

  const target = action === "undo" ? overlayStore.undoHistory(id) : overlayStore.redoHistory(id);
  if (!target) return;

  // A step from before a crop carries a different image; sync the canonical imageUrl so the
  // reconciler swaps the source. Position and marker convergence follow from the moved history top.
  const overlay = overlayStore.liveOverlays[id];
  if (overlay && overlay.imageUrl !== target.imageUrl) {
    overlayStore.updateOverlay(id, {
      imageUrl: target.imageUrl,
      filename: deriveOverlayFilename(id, target.imageUrl, overlay.filename),
    });
  }

  scheduleOverlayReconcile();
}

function handleKeyDown(event: KeyboardEvent) {
  // Let the browser's native undo/redo win while typing in a field, otherwise the global
  // capture-phase handler would also revert the selected overlay's position.
  if (isTypingTarget(event.target)) return;

  // Ctrl+Z
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    undo();
    // Ctrl+Y (AZERTY) or Ctrl+Shift+Z (QWERTY)
  } else if (
    event.ctrlKey &&
    (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))
  ) {
    redo();
  }
}

/** Document-level undo/redo shortcuts. */
export function initializeKeyboardShortcuts(): void {
  globalThis.addEventListener("keydown", handleKeyDown, true);
}
