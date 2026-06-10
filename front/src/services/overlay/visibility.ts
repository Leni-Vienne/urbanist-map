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
