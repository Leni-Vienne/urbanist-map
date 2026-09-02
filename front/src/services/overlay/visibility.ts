import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { activeFilterCount, matchesProjectFilters } from "@/services/core/filters";
import { useProjectStore } from "@/stores/projectStore";

type OverlayVisibilityInput = {
  status: OverlayData["status"];
  authorId?: OverlayData["authorId"];
  projectId?: OverlayData["projectId"];
};

/**
 * Determine if an overlay should be visible in the current mode
 * Centralized logic used by viewport pruning, mode switching, and rendering
 */
export function isOverlayVisible(
  overlay: OverlayVisibilityInput,
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

function matchesMapFilters(overlay: OverlayVisibilityInput, mode: AppMode): boolean {
  const project = overlay.projectId
    ? useProjectStore().getMapProjectById(overlay.projectId, mode)
    : null;
  if (!project) return activeFilterCount.value === 0;
  const lastModified = project.externalLastModified ?? project.updatedAt;
  return matchesProjectFilters({
    tags: project.tags,
    timelineStatus: project.timelineStatus,
    name: project.name,
    geometrySizeM: project.geometrySizeM,
    lastModifiedMs: lastModified.getTime(),
    hasImage: true,
  });
}

/**
 * Combined display predicate: mode/status/author visibility plus the user's map filters.
 */
export function shouldDisplayOverlay(
  overlay: OverlayVisibilityInput,
  mode: AppMode,
  currentUserId?: string,
): boolean {
  return isOverlayVisible(overlay, mode, currentUserId) && matchesMapFilters(overlay, mode);
}
