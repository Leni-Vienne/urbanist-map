import {
  showSubmissionDialog,
  submissionSummary,
  pendingSubmissionContext,
  isSubmitting,
} from "@/services/submission/submissionDialogState";
import {
  getStagedRender,
  clearStagedRender,
  type StagedRender,
} from "@/services/submission/stagedRenderState";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { getStagedOverlayModifications } from "@/services/overlay/unsavedState";
import { createProjectContext, formatEntityChanges, submitContext } from "./submissionService";
import {
  isOverlayChangeField,
  isProjectChangeField,
  type OverlayChangeField,
  type ProjectChangeField,
  type RemovableChange,
  type SubmissionChange,
  type SubmissionChangeType,
  type SubmissionContext,
  type SubmissionSummary,
} from "./submissionTypes";
import { toastError, toastSuccess, toastInfo } from "@/services/core/toast";
import { t } from "@/locales";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { deleteOverlayDirect } from "@/services/core/entityRemoval";
import { revertOverlayFieldModification } from "@/services/overlay/sync";
import type {
  PendingOverlayModification,
  OverlayObject,
  Project,
  ModifiableField,
} from "@/types/index";

function buildOverlayModificationChanges(
  mods: PendingOverlayModification[],
  overlays: Record<string, OverlayObject>,
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  for (const mod of mods) {
    const overlay = overlays[mod.overlayId];
    const thumbnailUrl = overlay?.filename
      ? buildThumbnailUrl(overlay.filename, overlay.status !== "approved")
      : undefined;

    if (mod.caption) {
      changes.push({
        field: "caption",
        oldValue: mod.caption.original ?? "",
        newValue: mod.caption.current,
        displayLabel: t("submission.overlayCaption"),
        overlayId: mod.overlayId,
        thumbnailUrl,
      });
    }
    if (mod.corners) {
      changes.push({
        field: "corners",
        oldValue: t("submission.previousPosition"),
        newValue: t("submission.newPosition"),
        displayLabel: t("submission.overlayPosition"),
        overlayId: mod.overlayId,
        thumbnailUrl,
      });
    }
  }
  return changes;
}

function getSuccessMessage(changeType: SubmissionChangeType | undefined): string {
  if (changeType === "update_approved") return t("submission.changeRequestSubmitted");
  if (changeType === "update_pending") return t("submission.changesSaved");
  return t("submission.submissionSuccessful");
}

// The context holds the staged mods snapshotted when the dialog opened, so a field reverted in the
// store must be dropped from that snapshot too, or the submit would rewrite the removed value. A
// mod left with neither field is dropped entirely.
function removeOverlayFieldFromContext(overlayId: string, field: ModifiableField): void {
  const ctx = pendingSubmissionContext.value;
  if (!ctx?.existingOverlayModifications) return;

  ctx.existingOverlayModifications = ctx.existingOverlayModifications.flatMap((mod) => {
    if (mod.overlayId !== overlayId) return [mod];
    const next: PendingOverlayModification = { ...mod };
    if (field === "corners") delete next.corners;
    else delete next.caption;
    return next.corners || next.caption ? [next] : [];
  });
}

function resetSubmissionState(): void {
  showSubmissionDialog.value = false;
  pendingSubmissionContext.value = null;
  submissionSummary.value = null;
}

// Build changes for NEW overlays (status is null, never submitted to backend)
function buildNewOverlayChanges(
  newOverlayIds: string[],
  overlays: Record<string, OverlayObject>,
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  for (const overlayId of newOverlayIds) {
    const overlay = overlays[overlayId];
    if (!overlay) continue;

    changes.push({
      field: "new_overlay",
      oldValue: "",
      newValue: overlay.caption ?? t("submission.newOverlay"),
      displayLabel: t("submission.newOverlay"),
      overlayId,
      thumbnailUrl: overlay.imageUrl,
    });
  }
  return changes;
}

function buildProjectWithOverlaysChanges(
  existingMods: PendingOverlayModification[],
  newOverlayIds: string[],
  overlays: Record<string, OverlayObject>,
  projectChanges: SubmissionChange[],
): SubmissionChange[] {
  return [
    ...buildNewOverlayChanges(newOverlayIds, overlays),
    ...buildOverlayModificationChanges(existingMods, overlays),
    ...projectChanges,
  ];
}

// Assemble the dialog summary + submit context from already-gathered inputs. Pure: the prepare
// step does the store/service lookups, this turns them into the two reactive payloads.
function buildSubmissionState(args: {
  projectId: string;
  project: Project | null;
  overlay: OverlayObject | undefined;
  projectHasChanges: boolean;
  pendingMods: PendingOverlayModification[];
  newOverlayIds: string[];
  projectChanges: SubmissionChange[];
  overlays: Record<string, OverlayObject>;
  stagedRender: StagedRender | undefined;
}): { summary: SubmissionSummary; context: SubmissionContext } {
  const { projectId, project, overlay, projectHasChanges, pendingMods, newOverlayIds } = args;

  // Mods on brand-new overlays are folded into the overlay publish itself; only mods on
  // already-published overlays flow into the summary and context.
  const existingOverlayMods = pendingMods.filter((mod) => !newOverlayIds.includes(mod.overlayId));

  const changes = buildProjectWithOverlaysChanges(
    existingOverlayMods,
    newOverlayIds,
    args.overlays,
    args.projectChanges,
  );

  // A render staged in the project form is published as its own moderated entity, so it never
  // affects the project/overlay changeType; it only adds a row and forces the moderation pill.
  if (args.stagedRender) {
    changes.push({
      field: "render",
      oldValue: "",
      newValue: t("render.imageChange"),
      displayLabel: t("render.label"),
      thumbnailUrl: args.stagedRender.previewUrl,
    });
  }

  const projectIsNew = project?.status === null;
  const { changeType, requiresModeration } = classifySubmission({
    projectIsNew,
    projectStatus: project?.status ?? null,
    projectHasChanges,
    overlayMods: existingOverlayMods,
    newOverlayIds,
  });

  return {
    summary: {
      entityName: project?.name ?? overlay?.caption ?? t("submission.newOverlay"),
      changes,
      requiresModeration: requiresModeration || Boolean(args.stagedRender),
      changeType,
    },
    context: {
      projectId,
      projectModified: projectHasChanges,
      existingOverlayModifications: existingOverlayMods,
      newOverlayIds,
      pendingRender: args.stagedRender ? { file: args.stagedRender.file } : undefined,
    },
  };
}

interface SubmissionClassification {
  changeType: SubmissionChangeType;
  requiresModeration: boolean;
}

interface SubmissionClassificationInput {
  projectIsNew: boolean;
  projectStatus: string | null;
  projectHasChanges: boolean;
  overlayMods: PendingOverlayModification[];
  newOverlayIds: string[];
}

function submissionRequiresModeration(input: SubmissionClassificationInput): boolean {
  if (input.newOverlayIds.length > 0) return true;
  if (input.overlayMods.some((mod) => mod.overlayStatus === "approved")) return true;
  return input.projectStatus === "approved";
}

function submissionChangeType(
  input: SubmissionClassificationInput,
  requiresModeration: boolean,
): SubmissionChangeType {
  if (input.projectIsNew || input.newOverlayIds.length > 0) return "create";
  if (requiresModeration) return "update_approved";
  return "update_pending";
}

// Single source of truth for the batch-level rollup shown in the dialog header. The service still
// routes each entity by its own status (getChangeType); this classifies the submission as a whole.
function classifySubmission(input: SubmissionClassificationInput): SubmissionClassification {
  const requiresModeration = submissionRequiresModeration(input);
  return {
    changeType: submissionChangeType(input, requiresModeration),
    requiresModeration,
  };
}

function getNewOverlaysForProject(projectId: string): OverlayObject[] {
  return Object.values(useOverlayStore().liveOverlays).filter(
    (overlay) => overlay.projectId === projectId && overlay.status === null,
  );
}

// Project metadata changes only apply when the project is loaded and was itself edited.
function collectProjectMetadataChanges(projectId: string): SubmissionChange[] {
  const fullProject = useProjectStore().projects[projectId];
  if (!fullProject) return [];
  return formatEntityChanges(createProjectContext(fullProject));
}

// Single entry point for every submission. Gathers the project's staged overlay mods, new
// overlays, metadata changes and staged render, classifies the batch, then opens the dialog.
// `project` is null when an overlay is selected from the map and its project was never loaded as
// a full entity: the submission then runs overlay-only, keyed by the overlay's projectId, with
// `overlay` supplying the dialog's entity name.
export function prepareSubmission(project: Project | null, overlay?: OverlayObject): void {
  const projectId = project?.id ?? overlay?.projectId;
  if (!projectId) return;

  const projectStore = useProjectStore();

  try {
    const projectHasChanges =
      projectStore.projects[projectId]?.isModified ?? project?.isModified ?? false;
    const pendingMods = getStagedOverlayModifications(projectId);
    const newOverlayIds = getNewOverlaysForProject(projectId).map((o) => o.id);

    const { summary, context } = buildSubmissionState({
      projectId,
      project,
      overlay,
      projectHasChanges,
      pendingMods,
      newOverlayIds,
      projectChanges: projectHasChanges ? collectProjectMetadataChanges(projectId) : [],
      overlays: useOverlayStore().liveOverlays,
      stagedRender: getStagedRender(projectId),
    });

    submissionSummary.value = summary;
    pendingSubmissionContext.value = context;
    showSubmissionDialog.value = true;
  } catch (error: unknown) {
    console.error("Error preparing submission:", error);
    toastError(error instanceof Error ? error.message : t("errors.preparingSubmission"));
  }
}

// Submit an overlay. Resolves its project (caller hint, then the store) for the full project path;
// when it can't (overlay selected from the map, project never loaded), prepareSubmission runs
// overlay-only off the overlay's projectId.
export function prepareOverlaySubmission(overlay: OverlayObject, project?: Project | null): void {
  const resolved =
    project ?? (overlay.projectId ? useProjectStore().projects[overlay.projectId] : null);
  prepareSubmission(resolved ?? null, overlay);
}

function handleSubmissionSuccess(): void {
  const message = getSuccessMessage(submissionSummary.value?.changeType);

  toastSuccess(message);

  resetSubmissionState();
}

export async function confirmSubmission(reason: string): Promise<void> {
  const context = pendingSubmissionContext.value;
  if (!context) return;

  try {
    isSubmitting.value = true;
    await submitContext(context, reason);
    useFocusStore().clearSelection();
    handleSubmissionSuccess();
  } catch (error: unknown) {
    console.error("Error submitting:", error);
    toastError(
      error instanceof Error ? error.message : t("errors.submissionFailed"),
      t("toast.submissionFailed"),
    );
  } finally {
    isSubmitting.value = false;
  }
}

export function cancelSubmission(): void {
  resetSubmissionState();
}

async function handleRemoveOverlayChange(
  overlayId: string,
  field: OverlayChangeField,
): Promise<void> {
  const overlayObject = useOverlayStore().liveOverlays[overlayId];

  // Handle removing a NEW overlay completely
  if (field === "new_overlay") {
    if (overlayObject) {
      await deleteOverlayDirect(overlayId);

      const extCtx = pendingSubmissionContext.value;
      if (extCtx?.newOverlayIds) {
        extCtx.newOverlayIds = extCtx.newOverlayIds.filter((id) => id !== overlayId);
      }
    }
    return;
  }

  if (overlayObject) {
    revertOverlayFieldModification(overlayId, field, overlayObject);
    removeOverlayFieldFromContext(overlayId, field);
  }
}

function handleRemoveProjectChange(field: ProjectChangeField): void {
  const projectId = pendingSubmissionContext.value?.projectId;
  if (projectId) {
    useProjectStore().resetProjectField(projectId, field);
  }

  // Close project edit form to force fresh data on reopen
  useUiStore().closeProjectEditForm();
}

export async function handleRemoveChange(
  index: number,
  field: RemovableChange,
  overlayId?: string,
): Promise<void> {
  if (!submissionSummary.value) return;

  // Remove the change at the specified index from the summary
  submissionSummary.value.changes.splice(index, 1);

  if (field === "render") {
    const renderProjectId = pendingSubmissionContext.value?.projectId;
    if (renderProjectId) clearStagedRender(renderProjectId);
    if (pendingSubmissionContext.value) pendingSubmissionContext.value.pendingRender = undefined;
  } else if (overlayId && isOverlayChangeField(field)) {
    await handleRemoveOverlayChange(overlayId, field);
  } else if (isProjectChangeField(field)) {
    handleRemoveProjectChange(field);
  }

  // If no more changes, close the dialog
  if (submissionSummary.value.changes.length === 0) {
    resetSubmissionState();
    toastInfo(t("submission.noChangesToSubmit"));
  }
}
