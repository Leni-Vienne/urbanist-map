export const APPROVAL_STATUS_VALUES = ["pending", "approved", "rejected", "replaced"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS_VALUES)[number];

export const TIMELINE_STATUS_VALUES = [
  "proposed",
  "planned",
  "under_construction",
  "completed",
  "canceled",
] as const;
export type TimelineStatus = (typeof TIMELINE_STATUS_VALUES)[number];
