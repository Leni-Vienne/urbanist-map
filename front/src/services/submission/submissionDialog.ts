import { computed, ref } from "vue";
import { showSubmissionDialog, isSubmitting } from "@/services/submission/submissionDialogState";
import { getStagedRender, clearStagedRender } from "@/services/submission/stagedRenderState";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import {
  getEditModeDefaultCaption,
  getStagedOverlayModifications,
} from "@/services/overlay/unsavedState";
import { getEditModeRestingCorners } from "@/services/overlay/positionState";
import { detectProjectChanges, submitDraft } from "./submissionService";
import {
  isOverlayChangeField,
  isProjectChangeField,
  type OverlayChangeField,
  type ProjectFieldChange,
  type ProjectChangeField,
  type ProjectSubmissionDraft,
  type RemovableChange,
  type SubmissionChange,
  type SubmissionChangeType,
  type SubmissionDraft,
  type SubmissionSummary,
} from "./submissionTypes";
import { toastError, toastSuccess, toastInfo } from "@/services/core/toast";
import { t } from "@/locales";
import { parseShapeCollection } from "@/utils/geojson";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { deleteOverlayDirect } from "@/services/entity/entityRemoval";
import { closeDetail } from "@/services/overlay/selection";
import { scheduleOverlayReconcile } from "@/services/overlay/mapLayers";
import type {
  PendingOverlayModification,
  OverlayObject,
  Project,
  ModifiableField,
} from "@/types/index";

const pendingSubmissionDraft = ref<SubmissionDraft | null>(null);

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

function getSuccessMessage(changeType: SubmissionChangeType): string {
  if (changeType === "update_approved") return t("submission.changeRequestSubmitted");
  if (changeType === "update_pending") return t("submission.changesSaved");
  return t("submission.submissionSuccessful");
}

function removeOverlayFieldFromDraft(overlayId: string, field: ModifiableField): void {
  const draft = pendingSubmissionDraft.value;
  if (!draft) return;

  draft.overlayModifications = draft.overlayModifications.flatMap((mod) => {
    if (mod.overlayId !== overlayId) return [mod];
    const next: PendingOverlayModification = { ...mod };
    if (field === "corners") delete next.corners;
    else delete next.caption;
    return next.corners || next.caption ? [next] : [];
  });
}

function resetSubmissionState(): void {
  showSubmissionDialog.value = false;
  pendingSubmissionDraft.value = null;
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

function buildProjectChanges(changes: ProjectFieldChange[]): SubmissionChange[] {
  return changes.map((change) => ({
    field: change.fieldName,
    oldValue: formatValueForDisplay(change.oldValue, change.fieldName),
    newValue: formatValueForDisplay(change.newValue, change.fieldName),
    displayLabel: t(`fields.${change.fieldName}`),
  }));
}

function formatValueForDisplay(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined || value === "") return "";

  if (fieldName === "geometry") {
    const shapes = parseShapeCollection(value);
    if (shapes) return t("shapes.geometrySummary", { count: shapes.geometries.length });
  }

  if (Array.isArray(value)) return `[${value.length} items]`;
  return String(value);
}

function buildProjectDraft(
  project: Project | null,
  changes: ProjectFieldChange[],
): ProjectSubmissionDraft | undefined {
  if (!project) return undefined;
  if (project.status === null) return { changeType: "create", changes: [] };
  if (changes.length === 0) return undefined;
  return {
    changeType: project.status === "approved" ? "update_approved" : "update_pending",
    changes,
  };
}

function classifySubmission(draft: SubmissionDraft) {
  const requiresModeration =
    draft.newOverlayIds.length > 0 ||
    draft.project?.changeType === "update_approved" ||
    draft.overlayModifications.some((mod) => mod.overlayStatus === "approved");
  const createsEntity = draft.project?.changeType === "create" || draft.newOverlayIds.length > 0;
  let changeType: SubmissionChangeType = "update_pending";
  if (createsEntity) changeType = "create";
  else if (requiresModeration) changeType = "update_approved";
  return {
    changeType,
    requiresModeration: requiresModeration || Boolean(draft.pendingRender),
  };
}

function buildSubmissionSummary(draft: SubmissionDraft): SubmissionSummary {
  const overlays = useOverlayStore().liveOverlays;
  const changes = [
    ...buildNewOverlayChanges(draft.newOverlayIds, overlays),
    ...buildOverlayModificationChanges(draft.overlayModifications, overlays),
    ...buildProjectChanges(draft.project?.changes ?? []),
  ];

  if (draft.pendingRender) {
    changes.push({
      field: "render",
      oldValue: "",
      newValue: t("render.imageChange"),
      displayLabel: t("render.label"),
      thumbnailUrl: draft.pendingRender.previewUrl,
    });
  }

  return { entityName: draft.entityName, changes, ...classifySubmission(draft) };
}

function getSubmissionSummary(): SubmissionSummary | null {
  const draft = pendingSubmissionDraft.value;
  return draft ? buildSubmissionSummary(draft) : null;
}

export const submissionSummary = computed(getSubmissionSummary);

function getNewOverlaysForProject(projectId: string): OverlayObject[] {
  return Object.values(useOverlayStore().liveOverlays).filter(
    (overlay) => overlay.projectId === projectId && overlay.status === null,
  );
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
  const projectHasChanges = projectStore.hasProjectDraft(projectId);
  const submissionProject = projectStore.projects[projectId] ?? project;
  const projectChanges =
    projectHasChanges && submissionProject ? detectProjectChanges(submissionProject) : [];
  const stagedRender = getStagedRender(projectId);

  pendingSubmissionDraft.value = {
    projectId,
    entityName: submissionProject?.name ?? overlay?.caption ?? t("submission.newOverlay"),
    project: buildProjectDraft(submissionProject, projectChanges),
    overlayModifications: getStagedOverlayModifications(projectId),
    newOverlayIds: getNewOverlaysForProject(projectId).map((o) => o.id),
    pendingRender: stagedRender ? { ...stagedRender, id: crypto.randomUUID() } : undefined,
  };

  showSubmissionDialog.value = true;
}

// Submit an overlay. Resolves its project from the store for the full project path; when it can't
// (overlay selected from the map, project never loaded), prepareSubmission runs overlay-only off
// the overlay's projectId.
export function prepareOverlaySubmission(overlay: OverlayObject): void {
  const resolved = overlay.projectId ? useProjectStore().projects[overlay.projectId] : null;
  prepareSubmission(resolved ?? null, overlay);
}

export async function confirmSubmission(reason: string): Promise<void> {
  const draft = pendingSubmissionDraft.value;
  if (!draft || isSubmitting.value) return;

  const successMessage = getSuccessMessage(classifySubmission(draft).changeType);

  try {
    isSubmitting.value = true;
    await submitDraft(draft, reason);
    closeDetail();
    toastSuccess(successMessage);
    resetSubmissionState();
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
    }

    const draft = pendingSubmissionDraft.value;
    if (draft) {
      draft.newOverlayIds = draft.newOverlayIds.filter((id) => id !== overlayId);
    }
    return;
  }

  if (overlayObject) {
    if (field === "caption") {
      useOverlayStore().updateOverlayDraft(overlayId, {
        caption: getEditModeDefaultCaption(overlayObject),
      });
    } else {
      const corners = getEditModeRestingCorners(overlayObject);
      if (corners?.length === 4) useOverlayStore().resetHistoryBaseline(overlayId, corners);
      scheduleOverlayReconcile();
    }
  }
  removeOverlayFieldFromDraft(overlayId, field);
}

function handleRemoveProjectChange(field: ProjectChangeField): void {
  const draft = pendingSubmissionDraft.value;
  if (!draft?.project) return;

  useProjectStore().resetProjectField(draft.projectId, field);
  draft.project.changes = draft.project.changes.filter((change) => change.fieldName !== field);
  if (draft.project.changeType !== "create" && draft.project.changes.length === 0) {
    useProjectStore().discardProjectDraft(draft.projectId);
    draft.project = undefined;
  }

  // Close project edit form to force fresh data on reopen
  useUiStore().closeProjectEditForm();
}

function hasSubmissionWork(draft: SubmissionDraft): boolean {
  return Boolean(
    draft.project ||
    draft.overlayModifications.length > 0 ||
    draft.newOverlayIds.length > 0 ||
    draft.pendingRender,
  );
}

export async function handleRemoveChange(
  field: RemovableChange,
  overlayId?: string,
): Promise<void> {
  const draft = pendingSubmissionDraft.value;
  if (!draft) return;

  if (field === "render") {
    clearStagedRender(draft.projectId);
    draft.pendingRender = undefined;
  } else if (overlayId && isOverlayChangeField(field)) {
    await handleRemoveOverlayChange(overlayId, field);
  } else if (isProjectChangeField(field)) {
    handleRemoveProjectChange(field);
  }

  if (!hasSubmissionWork(draft)) {
    resetSubmissionState();
    toastInfo(t("submission.noChangesToSubmit"));
  }
}
