import type { OverlayObject, OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

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
    // Hide: local-only (null/undefined), pending, rejected
    return overlay.status === "approved";
  }

  // Moderation mode: Show approved + pending from all users
  if (mode === "moderation") {
    // Hide: local-only (null/undefined), rejected
    // Show: approved, pending
    return overlay.status === "approved" || overlay.status === "pending";
  }

  // Edit mode: Show approved + user's own pending/local
  // Hide rejected
  if (overlay.status === "rejected") {
    return false;
  }

  // Show approved
  if (overlay.status === "approved") {
    return true;
  }

  // Show local (null status) - implies it's being created/edited by user
  if (overlay.status === null) {
    return true;
  }

  // Show pending ONLY if it belongs to current user
  if (overlay.status === "pending") {
    return overlay.authorId === currentUserId;
  }

  return false;
}
