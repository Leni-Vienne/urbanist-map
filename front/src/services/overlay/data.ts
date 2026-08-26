import { useOverlayStore } from "@/stores/overlayStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayData, OverlayHistoryState, OverlayPositionState, LatLng } from "@/types/index";
import type { AppMode } from "@shared/types";
import { isValidQuad, parseQuadValue } from "@/services/overlay/transform";
import { getOverlayImageCorners, getRenderedOverlayCorners } from "@/services/overlay/mapLayers";
import { useChangeRequestStore } from "@/stores/changeRequestStore";

type OverlayPositionInput = {
  id: string;
  status: OverlayData["status"];
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

// Single resolver for an overlay's on-map geometry. There is no single canonical position source;
// `purpose` picks the priority order:
//   "image"   (re)creates the raster, so it prefers the remembered/intended position:
//             suggested (open CR default) > history > backend corners > live image.
//   "marker"  tracks where the image actually sits, so it prefers the live position:
//             live image > suggested > history > backend corners.
//   "publish" is the geometry sent to the backend: history > backend corners. It reads neither the
//             map mode, the live image, nor the suggested position.
// History is used for the image and marker only while editing. The live read falls back to the last
// history entry when the raster is not rendered in edit mode. The suggested position is the edit-mode
// default for an overlay with an open change request, and the moderation display while an explicit
// suggested-position preview targets it. `history` is read off the passed object when
// present (the image path resolves a freshly-built object before it is committed to the store) and
// otherwise looked up by id. Returns null when no source yields a valid 4-corner quad, e.g. a
// render (kind='render'), whose corners are null.
export function resolveOverlayCorners(
  overlay: OverlayPositionInput,
  purpose: "image" | "marker" | "publish",
): LatLng[] | null {
  const history = overlay.history ?? useOverlayStore().liveOverlays[overlay.id]?.history ?? [];
  const historyCorners = history.at(-1)?.corners;
  const stored = overlay.baselineCorners;

  if (purpose === "publish") {
    if (isValidQuad(historyCorners)) return historyCorners;
    return isValidQuad(stored) ? stored : null;
  }

  const mode = useUiStore().mode;
  const viewApproved = mode === "view" && overlay.status === "approved";
  const liveCorners = viewApproved
    ? getRenderedOverlayCorners(overlay.id)
    : getOverlayImageCorners(overlay.id);

  const historyAllowed = mode === "edit";
  const fromHistory = historyAllowed && isValidQuad(historyCorners) ? historyCorners : null;

  const fromSuggested = getSuggestedDisplayCorners(overlay, mode);

  if (purpose === "marker") {
    if (isValidQuad(liveCorners)) return liveCorners;
    if (fromSuggested) return fromSuggested;
    if (fromHistory) return fromHistory;
    if (isValidQuad(stored)) return stored;
    return null;
  }

  if (fromSuggested) return fromSuggested;
  if (fromHistory) return fromHistory;
  if (isValidQuad(stored)) return stored;
  return liveCorners;
}
