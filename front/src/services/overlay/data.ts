import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import type { OverlayObject, LatLng } from "@/types/index";
import { isValidQuad, parseQuadValue } from "@/services/overlay/transform";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { getEditModeRestingCorners } from "@/services/overlay/defaultState";

type OverlayPositionInput = Pick<OverlayObject, "id" | "baselineCorners" | "ownProposal"> &
  Partial<Pick<OverlayObject, "history" | "showApprovedPosition">>;

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[id];
  if (!overlayObject) return;

  const newCaption = info.caption ?? null;
  if (overlayObject.caption === newCaption) return;

  overlayStore.updateOverlayDraft(id, { caption: newCaption });
}

// Pointer gestures stay transient in the editor; committed positions come from this state.
export function resolveOverlayCorners(overlay: OverlayPositionInput): LatLng[] | null {
  const mode = useUiStore().mode;
  if (mode === "edit") {
    const corners =
      (overlay.history?.length ?? 0) > 1
        ? resolveOverlaySubmissionCorners(overlay)
        : getEditModeRestingCorners(overlay);
    return isValidQuad(corners) ? corners : null;
  }
  if (mode === "moderation") {
    const preview = useChangeRequestStore().previewState;
    if (
      preview?.side === "suggested" &&
      preview.change.entityType === "overlay" &&
      preview.change.entityId === overlay.id
    ) {
      const corners = parseQuadValue(preview.change.newValue);
      if (corners) return corners;
    }
  }
  return isValidQuad(overlay.baselineCorners) ? overlay.baselineCorners : null;
}

// Geometry submitted to the backend is the staged history position when present, otherwise the
// backend baseline. Suggested change-request previews are display state, not a new submission.
export function resolveOverlaySubmissionCorners(overlay: OverlayPositionInput): LatLng[] | null {
  const historyCorners = overlay.history?.at(-1)?.corners;
  if (isValidQuad(historyCorners)) return historyCorners;
  return isValidQuad(overlay.baselineCorners) ? overlay.baselineCorners : null;
}
