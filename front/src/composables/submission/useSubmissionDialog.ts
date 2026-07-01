import {
  showSubmissionDialog,
  submissionSummary,
  pendingSubmissionContext,
  isSubmitting,
} from "./submissionDialogState";
import { getStagedRender, clearStagedRender, type StagedRender } from "./stagedRenderStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { useToast } from "@/composables/ui/useToast";
import { useSubmissionService } from "./useSubmissionService";
import type {
  SubmissionChange,
  SubmissionChangeType,
  SubmissionContext,
  SubmissionSummary,
} from "./submissionTypes";
import { t } from "@/locales";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { deleteOverlayDirect } from "@/services/core/entityRemoval";
import { revertOverlayFieldModification } from "@/services/overlay/sync";
import type {
  PendingOverlayModification,
  OverlayObject,
  Project,
  RemovableChange,
  Overlay,
  ModifiableField,
} from "@/types/index";

function buildOverlayModificationChanges(
  mods: PendingOverlayModification[],
  overlays: Record<string, OverlayObject | Overlay>,
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
        oldValue: mod.caption.original ?? t("common.noValue"),
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

// Helper to get image URL for new overlays
// A live OverlayObject carries imageUrl; a list Overlay may not, so fall back to thumbnail
function getImageUrl(overlay: OverlayObject | Overlay) {
  if ("imageUrl" in overlay && overlay.imageUrl) return overlay.imageUrl;
  if (overlay.filename) return buildThumbnailUrl(overlay.filename, true);
  return undefined;
}

function getSuccessMessage(changeType: string): string {
  if (changeType === "update_approved") return t("submission.changeRequestSubmitted");
  if (changeType === "update_pending") return t("submission.changesSaved");
  return t("submission.submissionSuccessful");
}

function updateExtendedContextAfterOverlayRemoval(overlayId: string): void {
  const ctx = pendingSubmissionContext.value;
  if (!ctx) return;
  if (ctx.existingOverlayModifications) {
    ctx.existingOverlayModifications = ctx.existingOverlayModifications.filter(
      (mod) => mod.overlayId !== overlayId,
    );
  }
}

function cancelSubmission(): void {
  showSubmissionDialog.value = false;
  pendingSubmissionContext.value = null;
  submissionSummary.value = null;
}

// Build changes for NEW overlays (status is null, never submitted to backend)
function buildNewOverlayChanges(
  newOverlayIds: string[],
  overlays: Record<string, OverlayObject | Overlay>,
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  for (const overlayId of newOverlayIds) {
    const overlay = overlays[overlayId];
    if (!overlay) continue;

    const imageUrl = getImageUrl(overlay);
    const overlayName = overlay.caption;

    changes.push({
      field: "new_overlay",
      oldValue: t("common.noValue"),
      newValue: overlayName ?? t("submission.newOverlay"),
      displayLabel: t("submission.newOverlay"),
      overlayId,
      thumbnailUrl: imageUrl,
    });
  }
  return changes;
}

function buildOverlayInfoMap(
  pendingMods: PendingOverlayModification[],
  newOverlayIds: string[],
  project: Project | undefined,
  storeOverlays: Record<string, OverlayObject>,
): Record<string, OverlayObject | Overlay> {
  const overlayInfoMap: Record<string, OverlayObject | Overlay> = {};

  for (const mod of pendingMods) {
    const storeOverlay = storeOverlays[mod.overlayId];
    if (storeOverlay) {
      overlayInfoMap[mod.overlayId] = storeOverlay;
    } else if (project?.overlays) {
      const projOverlay = project.overlays.find((o) => o.id === mod.overlayId);
      if (projOverlay) {
        overlayInfoMap[mod.overlayId] = projOverlay;
      }
    }
  }

  for (const overlayId of newOverlayIds) {
    const storeOverlay = storeOverlays[overlayId];
    if (storeOverlay) {
      overlayInfoMap[overlayId] = storeOverlay;
    }
  }

  return overlayInfoMap;
}

function buildProjectWithOverlaysChanges(
  pendingMods: PendingOverlayModification[],
  newOverlayIds: string[],
  overlayInfoMap: Record<string, OverlayObject | Overlay>,
  projectChanges: SubmissionChange[],
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  if (newOverlayIds.length > 0) {
    const newOverlayChanges = buildNewOverlayChanges(newOverlayIds, overlayInfoMap);
    changes.push(...newOverlayChanges);
  }

  if (pendingMods.length > 0) {
    const modsForExistingOverlays = pendingMods.filter(
      (mod) => !newOverlayIds.includes(mod.overlayId),
    );
    if (modsForExistingOverlays.length > 0) {
      const modChanges = buildOverlayModificationChanges(modsForExistingOverlays, overlayInfoMap);
      changes.push(...modChanges);
    }
  }

  changes.push(...projectChanges);

  return changes;
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
  overlayInfoMap: Record<string, OverlayObject | Overlay>;
  stagedRender: StagedRender | undefined;
}): { summary: SubmissionSummary; context: SubmissionContext } {
  const { projectId, project, overlay, projectHasChanges, pendingMods, newOverlayIds } = args;

  const changes = buildProjectWithOverlaysChanges(
    pendingMods,
    newOverlayIds,
    args.overlayInfoMap,
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
  const { changeType, requiresModeration, action } = classifySubmission({
    projectIsNew,
    projectStatus: project?.status ?? null,
    projectHasChanges,
    overlayMods: pendingMods,
    newOverlayIds,
  });

  return {
    summary: {
      action,
      entityName: project?.name ?? overlay?.caption ?? t("submission.newOverlay"),
      changes,
      requiresModeration: requiresModeration || Boolean(args.stagedRender),
      entityType: projectHasChanges || projectIsNew ? "project" : "overlay",
      changeType,
    },
    context: {
      changeType,
      projectId,
      projectModified: projectHasChanges,
      existingOverlayModifications: pendingMods,
      newOverlayIds,
      pendingRender: args.stagedRender ? { file: args.stagedRender.file } : undefined,
    },
  };
}

interface SubmissionClassification {
  changeType: SubmissionChangeType;
  requiresModeration: boolean;
  action: string;
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

function submissionAction(
  input: SubmissionClassificationInput,
  requiresModeration: boolean,
): string {
  if (input.projectIsNew) return t("project.publish");
  if (input.newOverlayIds.length > 0) return t("overlay.publishOverlay");
  if (requiresModeration) return t("submission.submitChangeRequest");
  if (input.projectHasChanges) return t("submission.updateProject");
  return t("submission.updateOverlays");
}

// Single source of truth for the batch-level rollup shown in the dialog header. The service still
// routes each entity by its own status (getChangeType); this classifies the submission as a whole.
function classifySubmission(input: SubmissionClassificationInput): SubmissionClassification {
  const requiresModeration = submissionRequiresModeration(input);
  return {
    changeType: submissionChangeType(input, requiresModeration),
    requiresModeration,
    action: submissionAction(input, requiresModeration),
  };
}

export function useSubmissionDialog() {
  const toast = useToast();
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const pendingModsStore = usePendingModificationsStore();
  const submissionService = useSubmissionService();

  function getNewOverlaysForProject(projectId: string): OverlayObject[] {
    return Object.values(overlayStore.overlays).filter(
      (overlay) => overlay.projectId === projectId && overlay.status === null,
    );
  }

  // Project metadata changes only apply when the project is loaded and was itself edited.
  function collectProjectMetadataChanges(projectId: string): SubmissionChange[] {
    const fullProject = projectStore.projects[projectId];
    if (!fullProject) return [];
    const projectContext = submissionService.createProjectContext(fullProject);
    return submissionService.formatEntityChanges(projectContext);
  }

  // Single entry point for every submission. Gathers the project's staged overlay mods, new
  // overlays, metadata changes and staged render, classifies the batch, then opens the dialog.
  // `project` is null when an overlay is selected from the map and its project was never loaded as
  // a full entity: the submission then runs overlay-only, keyed by the overlay's projectId, with
  // `overlay` supplying the dialog's entity name.
  function prepareSubmission(project: Project | null, overlay?: OverlayObject): void {
    const projectId = project?.id ?? overlay?.projectId;
    if (!projectId) return;

    try {
      const projectHasChanges =
        projectStore.projects[projectId]?.isModified ?? project?.isModified ?? false;
      const pendingMods = pendingModsStore.getModificationsForProject(projectId);
      const newOverlayIds = getNewOverlaysForProject(projectId).map((o) => o.id);

      const { summary, context } = buildSubmissionState({
        projectId,
        project,
        overlay,
        projectHasChanges,
        pendingMods,
        newOverlayIds,
        projectChanges: projectHasChanges ? collectProjectMetadataChanges(projectId) : [],
        overlayInfoMap: buildOverlayInfoMap(
          pendingMods,
          newOverlayIds,
          project ?? undefined,
          overlayStore.overlays,
        ),
        stagedRender: getStagedRender(projectId),
      });

      submissionSummary.value = summary;
      pendingSubmissionContext.value = context;
      showSubmissionDialog.value = true;
    } catch (error: unknown) {
      console.error("Error preparing submission:", error);
      toast.add({
        severity: "error",
        summary: t("common.error"),
        detail: error instanceof Error ? error.message : t("errors.preparingSubmission"),
        life: 5000,
      });
    }
  }

  // Submit an overlay. Resolves its project (caller hint, then the store) for the full project path;
  // when it can't (overlay selected from the map, project never loaded), prepareSubmission runs
  // overlay-only off the overlay's projectId.
  function prepareOverlaySubmission(overlay: OverlayObject, project?: Project | null): void {
    const resolved =
      project ?? (overlay.projectId ? projectStore.projects[overlay.projectId] : null);
    prepareSubmission(resolved ?? null, overlay);
  }

  function handleSubmissionSuccess(context: SubmissionContext): void {
    const message = getSuccessMessage(context.changeType);

    toast.add({
      severity: "success",
      summary: t("common.success"),
      detail: message,
      life: 3000,
    });

    // Close dialog and reset state
    showSubmissionDialog.value = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  }

  async function confirmSubmission(reason: string): Promise<void> {
    const context = pendingSubmissionContext.value;
    if (!context) return;

    try {
      isSubmitting.value = true;
      await submissionService.submitContext(context, reason);
      focusStore.clearSelection();
      handleSubmissionSuccess(context);
    } catch (error: unknown) {
      console.error("Error submitting:", error);
      toast.add({
        severity: "error",
        summary: t("toast.submissionFailed"),
        detail: error instanceof Error ? error.message : t("errors.submissionFailed"),
        life: 5000,
      });
    } finally {
      isSubmitting.value = false;
    }
  }

  async function handleRemoveOverlayChange(
    overlayId: string,
    field: RemovableChange,
  ): Promise<void> {
    const overlayObject = overlayStore.overlays[overlayId];

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

    // Handle resetting a field modification (geometry is never an overlay field)
    if (overlayObject) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const hasRemainingMods = revertOverlayFieldModification(
        overlayId,
        field as ModifiableField,
        overlayObject,
      );
      if (!hasRemainingMods) {
        updateExtendedContextAfterOverlayRemoval(overlayId);
      }
    }
  }

  function handleRemoveProjectChange(field: string): void {
    const projectId = pendingSubmissionContext.value?.projectId;
    if (projectId) {
      projectStore.resetProjectField(projectId, field as keyof Project);
    }

    // Close project edit form to force fresh data on reopen
    uiStore.closeProjectEditForm();
  }

  async function handleRemoveChange(
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
    } else if (overlayId) {
      await handleRemoveOverlayChange(overlayId, field);
    } else {
      handleRemoveProjectChange(field);
    }

    // If no more changes, close the dialog
    if (submissionSummary.value.changes.length === 0) {
      cancelSubmission();
      toast.add({
        severity: "info",
        summary: t("common.info"),
        detail: t("submission.noChangesToSubmit"),
        life: 3000,
      });
    }
  }

  return {
    showSubmissionDialog,
    submissionSummary,
    isSubmitting,

    prepareSubmission,
    prepareOverlaySubmission,

    confirmSubmission,
    cancelSubmission,
    handleRemoveChange,
  };
}
