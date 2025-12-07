// AI : Shared marker color logic for projects
// AI : Used by both useCityMarkers and useStandaloneProjectMarkers

import type { MarkerColor, Project } from "@/types/index";

/**
 * AI : Get project marker color based on status, timeline, and mode
 * Centralized logic to avoid duplication between city and standalone project markers
 */
export function getProjectMarkerColor(
  project: Project,
  mode: "view" | "edit" | "moderation",
): MarkerColor {
  if (mode === "moderation") {
    // AI : Moderation mode color logic - objective view for review (same as overlays)
    const status = project.status;

    // AI : Pending brand new projects
    if (status === "pending") return "yellow";

    // AI : Approved projects
    if (status === "approved") return "green";

    // AI : Rejected projects (shouldn't appear in moderation but just in case)
    return "grey";
  }

  if (mode === "edit") {
    // AI : Edit mode uses approval status colors like overlay markers
    const hasBeenModified = project.isModified ?? false;
    const status = project.status;

    // AI : Priority 1: Local modifications (shows user they have unsaved work)
    if (hasBeenModified) return "orange";

    // AI : Priority 2: Pending approval (awaiting moderation)
    if (status === "pending") return "yellow";

    // AI : Priority 3: Rejected projects
    if (status === "rejected") return "red";

    // AI : Priority 4: Approved and unmodified
    if (status === "approved") return "green";

    // AI : Default: New project not yet submitted (no status)
    return "red";
  }

  // AI : View mode uses timeline-based colors
  // AI : Pending projects always show as yellow (proposed/awaiting approval)
  if (project.status === "pending") {
    return "yellow"; // Pending approval
  }

  // AI : Timeline-based colors for approved/rejected projects
  const { proposalDate, startDate, endDate } = project;

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
