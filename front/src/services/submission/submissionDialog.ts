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
  type RemovableChange,
  type SubmissionChange,
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
import type { PendingOverlayModification, OverlayObject, Project } from "@/types/index";

interface PendingSubmission {
  projectId: string;
  entityName: string | null;
  renderId?: string;
}

const pendingSubmission = ref<PendingSubmission | null>(null);

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

function getSuccessMessage(outcome: { createdEntities: number; changeRequests: number }): string {
  if (outcome.createdEntities > 0) return t("submission.submissionSuccessful");
  if (outcome.changeRequests > 0) return t("submission.changeRequestSubmitted");
  return t("submission.changesSaved");
}

function resetSubmissionState(): void {
  showSubmissionDialog.value = false;
  pendingSubmission.value = null;
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
): ProjectFieldChange[] | undefined {
  if (!project) return undefined;
  if (project.status === null) return [];
  if (changes.length === 0) return undefined;
  return changes;
}

function buildSubmissionDraft(): SubmissionDraft | null {
  const pending = pendingSubmission.value;
  if (!pending) return null;

  const projectStore = useProjectStore();
  const project = projectStore.getProjectById(pending.projectId);
  const projectChanges =
    project && projectStore.hasProjectDraft(pending.projectId) ? detectProjectChanges(project) : [];
  const stagedRender = getStagedRender(pending.projectId);
  return {
    projectId: pending.projectId,
    entityName: pending.entityName,
    projectChanges: buildProjectDraft(project, projectChanges),
    overlayModifications: getStagedOverlayModifications(pending.projectId),
    newOverlayIds: getNewOverlaysForProject(pending.projectId).map(getOverlayId),
    pendingRender:
      stagedRender && pending.renderId ? { ...stagedRender, id: pending.renderId } : undefined,
  };
}

function getOverlayId(overlay: OverlayObject): string {
  return overlay.id;
}

function getSubmissionPresentation(draft: SubmissionDraft) {
  const project = useProjectStore().getProjectById(draft.projectId);
  const overlays = useOverlayStore().liveOverlays;
  const isCreation = project?.status === null || draft.newOverlayIds.length > 0;
  let changesApprovedEntity = Boolean(draft.projectChanges) && project?.status === "approved";
  for (const modification of draft.overlayModifications) {
    if (overlays[modification.overlayId]?.status === "approved") {
      changesApprovedEntity = true;
      break;
    }
  }
  return {
    isCreation,
    requiresModeration: isCreation || changesApprovedEntity || Boolean(draft.pendingRender),
  };
}

function buildSubmissionSummary(draft: SubmissionDraft): SubmissionSummary {
  const overlays = useOverlayStore().liveOverlays;
  const changes = [
    ...buildNewOverlayChanges(draft.newOverlayIds, overlays),
    ...buildOverlayModificationChanges(draft.overlayModifications, overlays),
    ...buildProjectChanges(draft.projectChanges ?? []),
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

  return { entityName: draft.entityName, changes, ...getSubmissionPresentation(draft) };
}

function getSubmissionSummary(): SubmissionSummary | null {
  const draft = buildSubmissionDraft();
  return draft ? buildSubmissionSummary(draft) : null;
}

export const submissionSummary = computed(getSubmissionSummary);

function getNewOverlaysForProject(projectId: string): OverlayObject[] {
  return Object.values(useOverlayStore().liveOverlays).filter(
    (overlay) => overlay.projectId === projectId && overlay.status === null,
  );
}

// Single entry point for every submission. The dialog derives its rows from current draft stores.
// `project` is null when an overlay is selected from the map and its project was never loaded as
// a full entity: the submission then runs overlay-only, keyed by the overlay's projectId, with
// `overlay` supplying the dialog's entity name.
export function prepareSubmission(project: Project | null, overlay?: OverlayObject): void {
  const projectId = project?.id ?? overlay?.projectId;
  if (!projectId) return;

  const projectStore = useProjectStore();
  const submissionProject = projectStore.projects[projectId] ?? project;
  const stagedRender = getStagedRender(projectId);

  pendingSubmission.value = {
    projectId,
    entityName: submissionProject?.name ?? overlay?.caption ?? t("submission.newOverlay"),
    renderId: stagedRender ? crypto.randomUUID() : undefined,
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
  const draft = buildSubmissionDraft();
  if (!draft || isSubmitting.value) return;

  try {
    isSubmitting.value = true;
    const outcome = await submitDraft(draft, reason);
    closeDetail();
    toastSuccess(getSuccessMessage(outcome));
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
}

function handleRemoveProjectChange(field: ProjectChangeField): void {
  const pending = pendingSubmission.value;
  if (!pending) return;

  useProjectStore().resetProjectField(pending.projectId, field);

  // Close project edit form to force fresh data on reopen
  useUiStore().closeProjectEditForm();
}

function hasSubmissionWork(draft: SubmissionDraft): boolean {
  return Boolean(
    draft.projectChanges ||
    draft.overlayModifications.length > 0 ||
    draft.newOverlayIds.length > 0 ||
    draft.pendingRender,
  );
}

export async function handleRemoveChange(
  field: RemovableChange,
  overlayId?: string,
): Promise<void> {
  const pending = pendingSubmission.value;
  if (!pending) return;

  if (field === "render") {
    clearStagedRender(pending.projectId);
  } else if (overlayId && isOverlayChangeField(field)) {
    await handleRemoveOverlayChange(overlayId, field);
  } else if (isProjectChangeField(field)) {
    handleRemoveProjectChange(field);
  }

  const draft = buildSubmissionDraft();
  if (!draft || !hasSubmissionWork(draft)) {
    resetSubmissionState();
    toastInfo(t("submission.noChangesToSubmit"));
  }
}
