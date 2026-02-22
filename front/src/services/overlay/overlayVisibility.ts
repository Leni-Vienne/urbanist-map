import type { OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

/**
 * AI : Determine if an overlay should be visible in the current mode
 * AI : Centralized logic used by viewport pruning, mode switching, and rendering
 */
export function isOverlayVisible(
  overlay: OverlayObject | OverlayData,
  mode: AppMode,
  currentUserId?: string,
): boolean {
  // AI : View mode: Only show approved overlays
  if (mode === "view") {
    // AI : Hide: local-only (null/undefined), pending, rejected
    return overlay.status === "approved";
  }

  // AI : Moderation mode: Show approved + pending from all users
  if (mode === "moderation") {
    // AI : Hide: local-only (null/undefined), rejected
    // AI : Show: approved, pending
    return overlay.status === "approved" || overlay.status === "pending";
  }

  // AI : Edit mode: Show approved + user's own pending/local
  if (mode === "edit") {
    // AI : Hide rejected
    if (overlay.status === "rejected") {
      return false;
    }

    // AI : Show approved
    if (overlay.status === "approved") {
      return true;
    }

    // AI : Show local (null status) - implies it's being created/edited by user
    if (overlay.status === null) {
      return true;
    }

    // AI : Show pending ONLY if it belongs to current user
    if (overlay.status === "pending") {
      return overlay.authorId === currentUserId;
    }

    return false;
  }

  // AI : Default fallback (should not happen)
  return false;
}
