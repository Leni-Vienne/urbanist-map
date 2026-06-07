import type { RemovableChange } from "@/types/index";
import type { PendingOverlayModification } from "@/stores/pinia/pendingModificationsStore";

export type SubmissionChangeType = "create" | "update_pending" | "update_approved";
type SubmissionEntityType = "project" | "overlay";

// Public submission context: a batch of work to do for a single project.
export interface SubmissionContext {
  changeType: SubmissionChangeType;
  projectId?: string;
  projectModified?: boolean;
  // Caption/corners changes captured locally on already-published overlays.
  existingOverlayModifications?: PendingOverlayModification[];
  // Brand-new overlays (status null) to publish.
  newOverlayIds?: string[];
  // A render image staged in the project form, uploaded and published after the project exists.
  pendingRender?: { file: File };
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
  action: string;
  entityName: string | null;
  changes: SubmissionChange[];
  requiresModeration: boolean;
  entityType: SubmissionEntityType;
  changeType: SubmissionChangeType;
}
