import type { OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { matchesSelectedTags, matchesTimelineStatusFilter } from "@/services/core/filters";

/**
 * Determine if an overlay should be visible in the current mode
 * Centralized logic used by viewport pruning, mode switching, and rendering
 */
export function isOverlayVisible(
  overlay: OverlayObject | OverlayData,
  mode: AppMode,
  currentUserId?: string,
): boolean {
  // View mode: Only show approved overlays
  if (mode === "view") {
    return overlay.status === "approved";
  }

  // Moderation mode: Show approved + pending from all users
  if (mode === "moderation") {
    return overlay.status === "approved" || overlay.status === "pending";
  }

  if (overlay.status === "rejected") {
    return false;
  }

  if (overlay.status === "approved") {
    return true;
  }

  // Local (null status) -- the overlay is being created by the user
  if (overlay.status === null) {
    return true;
  }

  // Pending: only visible to the author
  if (overlay.status === "pending") {
    return overlay.authorId === currentUserId;
  }

  return false;
}

/**
 * User-driven map filters: project tags in all modes, the project's timeline status in view mode.
 */
export function matchesMapFilters(overlay: OverlayObject | OverlayData, mode: AppMode): boolean {
  if (!matchesSelectedTags(overlay.project?.tags)) return false;
  if (mode !== "view") return true;
  return matchesTimelineStatusFilter(overlay.project?.timelineStatus);
}

/**
 * Combined display predicate: mode/status/author visibility plus the user's map filters.
 */
export function shouldDisplayOverlay(
  overlay: OverlayObject | OverlayData,
  mode: AppMode,
  currentUserId?: string,
): boolean {
  return isOverlayVisible(overlay, mode, currentUserId) && matchesMapFilters(overlay, mode);
}
