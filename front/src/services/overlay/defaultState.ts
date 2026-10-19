import type { OverlayObject } from "@/types/index";

type CaptionDefaults = Pick<OverlayObject, "ownProposal" | "baselineCaption">;

export function getEditModeDefaultCaption(overlay: CaptionDefaults): string | null {
  const proposedCaption = overlay.ownProposal?.caption;
  return proposedCaption === undefined ? overlay.baselineCaption : proposedCaption;
}
