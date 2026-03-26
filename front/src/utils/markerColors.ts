import type { MarkerColor, Project } from "@/types/index";
import type { ApprovalStatus, AppMode } from "@shared/types";
import type { TimelineStatus } from "../../../back/src/db/schema";

/**
 * Shared helper for status-based marker colors
 * Used by both project and overlay marker color functions to eliminate duplication
 * Handles the common pending/approved/rejected status logic for edit and moderation modes
 */
export function getApprovalStatusColor(
  status: ApprovalStatus | null | undefined,
  mode: AppMode,
  options: {
    isModified?: boolean;
    isReplacement?: boolean;
    isLocalUnsubmitted?: boolean;
  } = {},
): MarkerColor | null {
  const { isModified = false, isReplacement = false, isLocalUnsubmitted = false } = options;

  if (mode === "moderation") {
    // Local replacement (shouldn't appear in moderation, but for consistency)
    if (isReplacement && isLocalUnsubmitted) return "purple";

    // Submitted pending replacement
    if (status === "pending" && isReplacement && !isLocalUnsubmitted) return "yellow";

    if (status === "pending") return "yellow";

    if (status === "approved") return "green";

    if (status === "rejected") return "red";

    // Fallback
    return "grey";
  }

  if (mode === "edit") {
    // Priority 1: Local modifications (shows user has unsaved work)
    if (isModified) return "orange";

    // Priority 2: Pending approval
    if (status === "pending") return "yellow";

    // Priority 3: Rejected
    if (status === "rejected") return "red";

    // Priority 4: Approved and unmodified
    if (status === "approved") return "green";

    // Default: New item not yet submitted (no status = orange for local/unsaved)
    return "orange";
  }

  // Return null for view mode - caller handles timeline-based colors
  return null;
}

/**
 * Shared helper for timeline-based marker colors in view mode
 * Maps the timelineStatus field to a specific marker color
 */
export function getTimelineStatusColor(
  timelineStatus: TimelineStatus | null | undefined,
): MarkerColor {
  switch (timelineStatus) {
    case "proposed":
      return "yellow";
    case "planned":
      return "blue";
    case "under_construction":
      return "orange";
    case "completed":
      return "green";
    case "canceled":
      return "grey";
    default:
      return "yellow"; // Default to proposed/yellow if missing
  }
}

/**
 * Get project marker color based on status, timeline, and mode
 * Centralized logic to avoid duplication between city and standalone project markers
 */
export function getProjectMarkerColor(
  project: Project,
  mode: "view" | "edit" | "moderation",
): MarkerColor {
  // For edit and moderation modes, use shared status-based logic
  if (mode === "moderation" || mode === "edit") {
    const statusColor = getApprovalStatusColor(project.status, mode, {
      isModified: project.isModified ?? false,
    });
    if (statusColor) return statusColor;
  }

  // View mode uses timeline-based colors
  // Pending projects always show as yellow (proposed/awaiting approval)
  if (project.status === "pending") {
    return "yellow";
  }

  return getTimelineStatusColor(project.timelineStatus);
}
