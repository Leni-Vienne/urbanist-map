// Owns the confirmation workflow: prepare a target, review current drafts, submit or cancel.
import { computed } from "vue";
import {
  isSubmitting,
  pendingSubmission,
  resetSubmissionState,
} from "@/services/submission/submissionState";
import { getStagedRender, clearStagedRender } from "@/services/submission/stagedRenderState";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { getStagedOverlayModifications } from "@/services/overlay/unsavedState";
import { getEditModeDefaultCaption } from "@/services/overlay/defaultState";
import { getEditModeRestingCorners } from "@/services/overlay/positionState";
import { detectProjectChanges, submitDraft } from "./submissionService";
import {
  isOverlayChangeField,
  isProjectChangeField,
  type OverlayChangeField,
  type ProjectFieldChange,
  type ProjectChangeField,
  type RemovableChange,
  type SubmissionDraft,
  type SubmissionSummary,
} from "./submissionTypes";
import { toastError, toastSuccess } from "@/services/core/toast";
import { t } from "@/locales";
import { buildSubmissionSummary } from "./submissionSummary";
import { deleteOverlayDirect } from "@/services/entity/entityRemoval";
import { closeDetail } from "@/services/overlay/selection";
import { scheduleOverlayReconcile } from "@/services/overlay/mapLayers";
import type { OverlayObject, Project } from "@/types/index";

function getSuccessMessage(outcome: { createdEntities: number; changeRequests: number }): string {
  if (outcome.createdEntities > 0) return t("submission.submissionSuccessful");
  if (outcome.changeRequests > 0) return t("submission.changeRequestSubmitted");
  return t("submission.changesSaved");
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

function getSubmissionSummary(): SubmissionSummary | null {
  const draft = buildSubmissionDraft();
  if (!draft) return null;
  return buildSubmissionSummary(
    draft,
    useProjectStore().getProjectById(draft.projectId),
    useOverlayStore().liveOverlays,
  );
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
}

// Submit an overlay. Resolves its project from the store for the full project path; when it can't
// (overlay selected from the map, project never loaded), prepareSubmission runs overlay-only off
// the overlay's projectId.
export function prepareOverlaySubmission(overlay: OverlayObject): void {
  const resolved = overlay.projectId ? useProjectStore().projects[overlay.projectId] : null;
  prepareSubmission(resolved ?? null, overlay);
}

export async function confirmSubmission(reason: string): Promise<void> {
  const pending = pendingSubmission.value;
  const draft = buildSubmissionDraft();
  if (!draft || isSubmitting.value) return;

  try {
    const outcome = await submitDraft(draft, reason);
    if (pendingSubmission.value !== pending) return;
    closeDetail();
    toastSuccess(getSuccessMessage(outcome));
    resetSubmissionState();
  } catch (error: unknown) {
    console.error("Error submitting:", error);
    if (pendingSubmission.value !== pending) return;
    toastError(
      error instanceof Error ? error.message : t("errors.submissionFailed"),
      t("toast.submissionFailed"),
    );
  }
}

export function cancelSubmission(): void {
  if (isSubmitting.value) return;
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
  if (isSubmitting.value) return;
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
  }
}
