import type { LatLng, OverlayObject } from "@/types/index";
import { isValidQuad } from "@/services/overlay/transform";

type CaptionDefaults = Pick<OverlayObject, "ownProposal" | "baselineCaption">;

export function getEditModeDefaultCaption(overlay: CaptionDefaults): string | null {
  const proposedCaption = overlay.ownProposal?.caption;
  return proposedCaption === undefined ? overlay.baselineCaption : proposedCaption;
}

// The edit-mode default and first undo target: the user's proposal unless they chose to view
// the approved position. Caption-only proposals keep the baseline corners.
export function getEditModeRestingCorners(
  overlay: Pick<OverlayObject, "ownProposal" | "baselineCorners"> &
    Partial<Pick<OverlayObject, "showApprovedPosition">>,
): LatLng[] | null {
  const suggested = overlay.showApprovedPosition ? undefined : overlay.ownProposal?.corners;
  return isValidQuad(suggested) ? suggested : overlay.baselineCorners;
}
