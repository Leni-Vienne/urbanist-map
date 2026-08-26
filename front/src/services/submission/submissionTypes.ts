import type { Project, PendingOverlayModification } from "@/types/index";
import type { FieldChange, ProjectFieldName, OverlayFieldName } from "@shared/validation/schemas";

// The project fields compared for change detection, and the only ones a project row can name.
// Each must also be a field a change request may carry, or submitting it would be rejected.
export const PROJECT_CHANGE_FIELDS = [
  "name",
  "description",
  "sourceUrl",
  "timelineStatus",
  "proposalDate",
  "startDate",
  "endDate",
  "endDatePrecision",
  "proposalDatePrecision",
  "startDatePrecision",
  "geometry",
  "tags",
] as const satisfies readonly (keyof Project & ProjectFieldName)[];

// "new_overlay" is a dialog row kind only: a new overlay is published, never change-requested.
const OVERLAY_CHANGE_FIELDS = ["caption", "corners", "new_overlay"] as const satisfies readonly (
  | OverlayFieldName
  | "new_overlay"
)[];

export type ProjectChangeField = (typeof PROJECT_CHANGE_FIELDS)[number];
export type OverlayChangeField = (typeof OVERLAY_CHANGE_FIELDS)[number];

// Every row kind the confirmation dialog can display and remove.
export type RemovableChange = ProjectChangeField | OverlayChangeField | "render";

export function isOverlayChangeField(field: RemovableChange): field is OverlayChangeField {
  return (OVERLAY_CHANGE_FIELDS as readonly string[]).includes(field);
}

export function isProjectChangeField(field: RemovableChange): field is ProjectChangeField {
  return (PROJECT_CHANGE_FIELDS as readonly string[]).includes(field);
}

export type SubmissionChangeType = "create" | "update_pending" | "update_approved";

export type ProjectFieldChange = FieldChange & { fieldName: ProjectChangeField };

export interface ProjectSubmissionDraft {
  changeType: SubmissionChangeType;
  changes: ProjectFieldChange[];
}

export interface SubmissionDraft {
  projectId: string;
  entityName: string | null;
  project?: ProjectSubmissionDraft;
  overlayModifications: PendingOverlayModification[];
  newOverlayIds: string[];
  pendingRender?: { id: string; file: File; previewUrl: string };
}

export interface SubmissionChange {
  field: RemovableChange;
  oldValue: unknown;
  newValue: unknown;
  displayLabel: string;
  // Optional overlay identification for deletion and thumbnail display
  overlayId?: string;
  thumbnailUrl?: string;
}

export interface SubmissionSummary {
  entityName: string | null;
  changes: SubmissionChange[];
  requiresModeration: boolean;
  changeType: SubmissionChangeType;
}
