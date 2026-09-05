import type { OverlayObject } from "@/types/index";

type CaptionDefaults = Pick<
  OverlayObject,
  "hasPendingChanges" | "suggestedCaption" | "baselineCaption"
>;

export function getEditModeDefaultCaption(overlay: CaptionDefaults): string | null {
  if (
    overlay.hasPendingChanges === true &&
    overlay.suggestedCaption !== null &&
    overlay.suggestedCaption !== undefined
  ) {
    return overlay.suggestedCaption;
  }
  return overlay.baselineCaption;
}
