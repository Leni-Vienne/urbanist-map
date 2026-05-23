import type { MarkerColor } from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import type { TimelineStatus } from "../../../back/src/db/schema";

export function getApprovalStatusColor(
  status: ApprovalStatus | null | undefined,
  mode: "edit" | "moderation",
  options: {
    isModified?: boolean;
    isReplacement?: boolean;
  } = {},
): MarkerColor {
  const { isModified = false, isReplacement = false } = options;

  if (mode === "moderation") {
    // A replacement the user is editing stands out from the approved/pending overlays.
    if (isReplacement && isModified) return "purple";
    if (status === "pending") return "yellow";
    if (status === "approved") return "green";
    if (status === "rejected") return "red";
    return "grey";
  }

  // edit mode
  if (isModified) return "orange";
  if (status === "pending") return "yellow";
  if (status === "rejected") return "red";
  if (status === "approved") return "green";
  return "orange";
}

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
      return "yellow";
  }
}

export function getProjectMarkerColor(
  project: { status: ApprovalStatus | null; isModified?: boolean; timelineStatus: TimelineStatus },
  mode: "view" | "edit" | "moderation",
): MarkerColor {
  if (mode === "moderation" || mode === "edit") {
    return getApprovalStatusColor(project.status, mode, {
      isModified: project.isModified ?? false,
    });
  }

  if (project.status === "pending") {
    return "yellow";
  }

  return getTimelineStatusColor(project.timelineStatus);
}
