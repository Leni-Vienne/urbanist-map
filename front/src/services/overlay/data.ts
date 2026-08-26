import { useOverlayStore } from "@/stores/overlayStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayHistoryState, OverlayPositionState, LatLng } from "@/types/index";
import type { AppMode } from "@shared/types";
import { isValidQuad, parseQuadValue } from "@/services/overlay/transform";
import { useChangeRequestStore } from "@/stores/changeRequestStore";

type OverlayPositionInput = {
  id: string;
  baselineCorners: LatLng[] | null;
  suggestedCorners?: LatLng[];
  history?: OverlayHistoryState[];
  positionState?: OverlayPositionState;
};

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[id];
  if (!overlayObject) return;

  const newCaption = info.caption ?? null;
  if (overlayObject.caption === newCaption) return;

  overlayStore.updateOverlay(id, { caption: newCaption });
}

// The corners an active moderation suggested-position preview shows for this overlay: the
// previewed change request's own proposed geometry, read off the request rather than any field on
// the overlay object. Null when no suggested-position preview targets the overlay or the request's
// value is not a valid quad.
function getModerationPreviewCorners(overlayId: string): LatLng[] | null {
  const preview = useChangeRequestStore().previewState;
  if (preview.type !== "suggested" || preview.overlayId !== overlayId) return null;
  const change = useModerationStore().changeRequests.find((cr) => cr.id === preview.changeId);
  return parseQuadValue(change?.newValue);
}

// The suggested position an overlay displays. Edit mode uses it only while the overlay's state
// rests there; staged edits and the "view approved position" toggle move it to other position
// states. Moderation uses the previewed change request's own corners while an explicit
// suggested-position preview targets the overlay. Null in view mode.
function getSuggestedDisplayCorners(overlay: OverlayPositionInput, mode: AppMode): LatLng[] | null {
  if (mode === "edit") {
    const rests = overlay.positionState === "suggested";
    return rests && isValidQuad(overlay.suggestedCorners) ? overlay.suggestedCorners : null;
  }
  if (mode === "moderation") return getModerationPreviewCorners(overlay.id);
  return null;
}

// Resolve the geometry displayed in the current mode entirely from application state. During an
// active pointer gesture the editor owns a separate transient transform and commits it to history
// when the gesture ends.
export function resolveOverlayCorners(overlay: OverlayPositionInput): LatLng[] | null {
  const history = overlay.history ?? useOverlayStore().liveOverlays[overlay.id]?.history ?? [];
  const historyCorners = history.at(-1)?.corners;
  const stored = overlay.baselineCorners;
  const mode = useUiStore().mode;
  const fromSuggested = getSuggestedDisplayCorners(overlay, mode);
  if (fromSuggested) return fromSuggested;
  if (mode === "edit" && isValidQuad(historyCorners)) return historyCorners;
  if (isValidQuad(stored)) return stored;
  return null;
}

// Geometry submitted to the backend is the staged history position when present, otherwise the
// backend baseline. Suggested change-request previews are display state, not a new submission.
export function resolveOverlaySubmissionCorners(overlay: OverlayPositionInput): LatLng[] | null {
  const history = overlay.history ?? useOverlayStore().liveOverlays[overlay.id]?.history ?? [];
  const historyCorners = history.at(-1)?.corners;
  if (isValidQuad(historyCorners)) return historyCorners;
  return isValidQuad(overlay.baselineCorners) ? overlay.baselineCorners : null;
}
