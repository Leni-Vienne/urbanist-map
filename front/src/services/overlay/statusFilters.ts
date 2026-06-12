import type { OverlayData, OverlayObject } from "@/types/index";
import type { AppMode } from "@shared/types";
import { matchesSelectedTags, visibleStates } from "@/services/map/filters";

export function filterByStatus<T extends OverlayObject | OverlayData>(
  overlays: T[],
  mode: AppMode,
): T[] {
  return overlays.filter((overlay) => shouldShowOverlay(overlay, mode));
}

function shouldShowOverlay(overlay: OverlayObject | OverlayData, mode: AppMode) {
  if (mode === "view" && overlay.status === "pending") {
    return false;
  }

  if (!matchesSelectedTags(overlay.project?.tags)) {
    return false;
  }

  if (mode !== "view") {
    return true;
  }

  // In view mode, filter by the project's timeline status
  const timelineStatus = overlay.project?.timelineStatus;
  if (!timelineStatus) return visibleStates.value.proposed; // fallback: treat as proposed
  return visibleStates.value[timelineStatus];
}
