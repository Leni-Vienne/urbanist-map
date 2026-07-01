// Keeps an overlay's desired state in sync across its store and its live map representation.
//
// `applyOverlayCorners` is the low-level primitive: it pushes a set of corners onto the image
// layer, edit handles, marker pin and (optionally) the history baseline + tooltip. It is the
// shared engine behind resetting to the approved position and previewing a change request's
// position, each of which previously reimplemented this same sync dance.
//
// `revertOverlayFieldModification` is a command built on top of it: it restores a staged field
// edit (corners or caption) to its captured baseline in the stores, then syncs the map to match.
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { getImageHandle, setOverlayImageCorners } from "@/services/overlay/mapLayers";
import { refreshEditHandles } from "@/services/overlay/editing";
import { updateMarkerPosition } from "@/services/overlay/markers";
import type { ModifiableField, OverlayObject } from "@/types/index";

interface ApplyOverlayCornersOptions {
  // Collapse undo/redo history to these corners, so re-entering edit mode starts from here.
  resetHistory?: boolean;
  // Re-sync the drag surface, corner markers and outline; skip when not in an editing context.
  refreshHandles?: boolean;
  // Recolor/relabel the marker tooltip after the position change.
  refreshTooltip?: boolean;
}

export function applyOverlayCorners(
  overlayObject: OverlayObject,
  corners: { lat: number; lng: number }[],
  options: ApplyOverlayCornersOptions = {},
): void {
  const overlayId = overlayObject.id;
  const hasFullCorners = corners.length === 4;

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

function resetOverlayField(
  field: ModifiableField,
  overlayId: string,
  overlayObject: OverlayObject,
  capturedOriginalCaption: string | null | undefined,
  capturedOriginalCorners: { lat: number; lng: number }[] | null | undefined,
): void {
  if (field === "corners") {
    const cornersToUse = capturedOriginalCorners ?? overlayObject.baselineCorners;
    applyOverlayCorners(overlayObject, cornersToUse, { resetHistory: true, refreshHandles: true });
  } else if (capturedOriginalCaption !== undefined) {
    useOverlayStore().updateOverlay(overlayId, { caption: capturedOriginalCaption ?? "" });
  }
}

// Reverts one field of a staged overlay modification (caption or corners) back to its captured
// baseline, syncing the image layer, edit handles, marker and tooltip. Returns true if other staged
// fields remain.
export function revertOverlayFieldModification(
  overlayId: string,
  field: ModifiableField,
  overlayObject: OverlayObject,
): boolean {
  const pendingModsStore = usePendingModificationsStore();
  const overlayStore = useOverlayStore();

  const pendingMod = pendingModsStore.getPendingModifications(overlayId);
  const capturedOriginalCaption = pendingMod?.caption?.original;
  const capturedOriginalCorners = pendingMod?.corners?.original;

  const hasRemainingMods = pendingModsStore.clearFieldModification(overlayId, field);

  resetOverlayField(
    field,
    overlayId,
    overlayObject,
    capturedOriginalCaption,
    capturedOriginalCorners,
  );

  if (!hasRemainingMods) {
    overlayStore.updateOverlay(overlayId, { isModified: false });
  }

  return hasRemainingMods;
}
