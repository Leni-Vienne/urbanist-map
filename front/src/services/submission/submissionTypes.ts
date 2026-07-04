import type { RemovableChange, PendingOverlayModification } from "@/types/index";

export type SubmissionChangeType = "create" | "update_pending" | "update_approved";

// Public submission context: a batch of work to do for a single project.
export interface SubmissionContext {
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
