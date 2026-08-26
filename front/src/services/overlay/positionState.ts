import type { LatLng, OverlayPositionState } from "@/types/index";
import { isValidQuad } from "@/services/overlay/transform";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUiStore } from "@/stores/uiStore";
import { useModerationStore } from "@/stores/moderationStore";

// Whether the overlay has an open change request as the current mode defines it: any requester's in
// moderation (the country's pending set), otherwise the current user's own (`hasPendingChanges`).
export function hasOpenChangeRequest(overlay: {
  id: string;
  hasPendingChanges?: boolean;
}): boolean {
  if (useUiStore().mode === "moderation") {
    return useModerationStore().changeRequests.some(
      (cr) => cr.entityType === "overlay" && cr.entityId === overlay.id,
    );
  }
  return overlay.hasPendingChanges === true;
}

// The position an overlay shows in edit mode absent any staged edits: the suggested position of
// the user's own open change request when one exists, otherwise the backend baseline.
function getEditModeDefaultCorners(overlay: {
  hasPendingChanges?: boolean;
  suggestedCorners?: LatLng[];
  baselineCorners: LatLng[] | null;
}): LatLng[] | null {
  if (overlay.hasPendingChanges === true && isValidQuad(overlay.suggestedCorners)) {
    return overlay.suggestedCorners;
  }
  return overlay.baselineCorners;
}

// The edit-mode default, except when the user explicitly toggled "view approved position"
// (positionState === "approved-toggled"), which shows the baseline. This is the position an
// overlay with no staged edits rests at in edit mode, and the history seed / undo target.
export function getEditModeRestingCorners(overlay: {
  hasPendingChanges?: boolean;
  suggestedCorners?: LatLng[];
  baselineCorners: LatLng[] | null;
  positionState?: OverlayPositionState;
}): LatLng[] | null {
  if (overlay.positionState === "approved-toggled") return overlay.baselineCorners;
  return getEditModeDefaultCorners(overlay);
}

// Whether the map shows the suggested (proposed) state of an overlay's open change request.
// Edit mode defaults to it (any state other than the explicit approved-position toggle, so
// caption-only CRs still count). Non-edit modes show the approved state unless an explicit
// moderation preview of the suggested position is active for this overlay.
export function showsSuggestedState(overlay: {
  id: string;
  positionState?: OverlayPositionState;
}): boolean {
  if (useUiStore().mode === "edit") {
    return overlay.positionState !== "approved-toggled";
  }
  const preview = useChangeRequestStore().previewState;
  return preview.type === "suggested" && preview.overlayId === overlay.id;
}
