// Keeps an overlay's desired state in sync across its store and its live map representation.
//
// `applyOverlayCorners` is the low-level primitive: it pushes a set of corners onto the image
// layer, edit handles, marker pin and (optionally) the history baseline + tooltip. It is the
// shared engine behind resetting to the approved position and previewing a change request's
// position, each of which previously reimplemented this same sync dance.
//
// `revertOverlayFieldModification` is a command built on top of it: it reverts a staged field
// edit (corners or caption), then syncs the map to match. A corners revert targets the edit-mode
// default position (an open change request's suggested position, otherwise baseline).
import { useOverlayStore } from "@/stores/overlayStore";
import { getImageHandle, setOverlayImageCorners } from "@/services/overlay/mapLayers";
import { refreshEditHandles } from "@/services/overlay/editing";
import { updateMarkerPosition } from "@/services/overlay/markers";
import { isValidQuad, getEditModeDefaultCorners } from "@/services/overlay/transform";
import {
  getStagedCornersDelta,
  getStagedCaptionDelta,
  getEditModeDefaultCaption,
} from "@/utils/unsavedState";
import type { LatLng, ModifiableField, OverlayObject } from "@/types/index";

interface ApplyOverlayCornersOptions {
  // Collapse undo/redo history to these corners, so re-entering edit mode starts from here.
  resetHistory?: boolean;
  // Re-sync the drag surface, corner markers and outline; skip when not in an editing context.
  refreshHandles?: boolean;
}

export function applyOverlayCorners(
  overlayObject: OverlayObject,
  corners: LatLng[] | null,
  options: ApplyOverlayCornersOptions = {},
): void {
  const overlayId = overlayObject.id;
  const hasFullCorners = isValidQuad(corners);

  if (options.resetHistory && hasFullCorners) {
    useOverlayStore().resetHistoryBaseline(overlayId, corners);
  }

  // setOverlayImageCorners is a no-op without a handle, but refreshEditHandles is not, so guard both.
  if (getImageHandle(overlayId) && hasFullCorners) {
    setOverlayImageCorners(overlayId, corners);
    if (options.refreshHandles) refreshEditHandles();
  }

  // Reads the live image corners (just set) and falls back to overlayObject.baselineCorners otherwise.
  updateMarkerPosition(overlayObject);
}

// Reverts one field of a staged overlay modification (caption or corners), syncing the image
// layer, edit handles, marker and tooltip. Both reverts target the edit-mode default (an open
// change request's suggested value, otherwise the approved baseline). Returns true if the
// overlay's other field is still staged.
export function revertOverlayFieldModification(
  overlayId: string,
  field: ModifiableField,
  overlayObject: OverlayObject,
): boolean {
  if (field === "corners") {
    applyOverlayCorners(overlayObject, getEditModeDefaultCorners(overlayObject), {
      resetHistory: true,
      refreshHandles: true,
    });
    return getStagedCaptionDelta(overlayObject) !== null; // caption still staged?
  }

  useOverlayStore().updateOverlay(overlayId, {
    caption: getEditModeDefaultCaption(overlayObject),
  });
  return getStagedCornersDelta(overlayObject) !== null; // corners still staged?
}
