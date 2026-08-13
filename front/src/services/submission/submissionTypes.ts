import type { Project, PendingOverlayModification } from "@/types/index";
import type { ProjectFieldName, OverlayFieldName } from "@shared/validation/schemas";

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

export interface SubmissionWriteContext {
  projectId?: string;
  projectModified?: boolean;
  // Caption/corners changes captured locally on already-published overlays.
  // Never contains overlays listed in newOverlayIds.
  existingOverlayModifications?: PendingOverlayModification[];
  // Brand-new overlays (status null) to publish.
  newOverlayIds?: string[];
  // A render image staged in the project form, uploaded and published after the project exists.
  pendingRender?: { file: File };
}

// Public submission context: a batch of work to do for a single project.
export interface SubmissionContext extends SubmissionWriteContext {
  // Project classification captured with the dialog snapshot.
  projectIsNew: boolean;
  projectStatus: Project["status"];
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
