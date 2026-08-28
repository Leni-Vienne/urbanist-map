import type { PendingOverlayModification } from "@/types/index";
import { PROJECT_CHANGE_FIELDS, type OverlayFieldName } from "@shared/validation/schemas";

export { PROJECT_CHANGE_FIELDS } from "@shared/validation/schemas";

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

export interface ProjectFieldChange {
  fieldName: ProjectChangeField;
  oldValue: unknown;
  newValue: unknown;
}

export interface SubmissionDraft {
  projectId: string;
  entityName: string | null;
  projectChanges?: ProjectFieldChange[];
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
  isCreation: boolean;
}
