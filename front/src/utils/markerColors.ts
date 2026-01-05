// AI : Shared marker color logic for projects
// AI : Used by both useCityMarkers and useStandaloneProjectMarkers

import type { MarkerColor, Project } from "@/types/index";
import type { ApprovalStatus, MapMode } from "@shared/types";

/**
 * AI : Shared helper for status-based marker colors
 * AI : Used by both project and overlay marker color functions to eliminate duplication
 * AI : Handles the common pending/approved/rejected status logic for edit and moderation modes
 */
export function getApprovalStatusColor(
  status: ApprovalStatus | null | undefined,
  mode: MapMode,
  options: {
    isModified?: boolean;
    isReplacement?: boolean;
    isLocalUnsubmitted?: boolean;
  } = {},
): MarkerColor | null {
  const { isModified = false, isReplacement = false, isLocalUnsubmitted = false } = options;

  if (mode === "moderation") {
    // AI : Local replacement (shouldn't appear in moderation, but for consistency)
    if (isReplacement && isLocalUnsubmitted) return "purple";

    // AI : Submitted pending replacement
    if (status === "pending" && isReplacement && !isLocalUnsubmitted) return "yellow";

    // AI : Pending brand new items
    if (status === "pending") return "yellow";

    // AI : Approved items
    if (status === "approved") return "green";

    // AI : Rejected items
    if (status === "rejected") return "red";

    // AI : Fallback
    return "grey";
  }

  if (mode === "edit") {
    // AI : Priority 1: Local modifications (shows user has unsaved work)
    if (isModified) return "orange";

    // AI : Priority 2: Pending approval
    if (status === "pending") return "yellow";

    // AI : Priority 3: Rejected
    if (status === "rejected") return "red";

    // AI : Priority 4: Approved and unmodified
    if (status === "approved") return "green";

    // AI : Default: New item not yet submitted (no status = red)
    return "red";
  }

  // AI : Return null for view mode - caller handles timeline-based colors
  return null;
}

/**
 * AI : Shared helper for timeline-based marker colors in view mode
 * AI : Used by both project and overlay marker color functions to eliminate duplication
 */
export function getTimelineBasedColor(
  proposalDate: Date | string | null | undefined,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
): MarkerColor {
  // AI : If only proposalDate is set (no start date), it's just a proposal
  if (proposalDate && !startDate) return "yellow"; // Proposed but not started (nor planned)

  // AI : If no start date but has other dates, consider it not yet scheduled
  if (!startDate) return "yellow"; // Not yet scheduled

  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (start > now) return "green"; // Upcoming
  if (end && end <= now) return "grey"; // Completed
  return "orange"; // Ongoing
}

/**
 * AI : Get project marker color based on status, timeline, and mode
 * Centralized logic to avoid duplication between city and standalone project markers
 */
export function getProjectMarkerColor(
  project: Project,
  mode: "view" | "edit" | "moderation",
): MarkerColor {
  // AI : For edit and moderation modes, use shared status-based logic
  if (mode === "moderation" || mode === "edit") {
    const statusColor = getApprovalStatusColor(project.status, mode, {
      isModified: project.isModified ?? false,
    });
    if (statusColor) return statusColor;
  }

  // AI : View mode uses timeline-based colors
  // AI : Pending projects always show as yellow (proposed/awaiting approval)
  if (project.status === "pending") {
    return "yellow"; // Pending approval
  }

  // AI : Use shared timeline helper
  return getTimelineBasedColor(project.proposalDate, project.startDate, project.endDate);
}
