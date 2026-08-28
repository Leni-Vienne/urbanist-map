import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { trpc, type RouterOutput } from "@/client";
import { uploadImageFile } from "@/services/submission/uploadImageFile";
import { clearStagedRender } from "@/services/submission/stagedRenderState";
import type { Project, OverlayObject, PendingOverlayModification } from "@/types/index";
import {
  projectSchema,
  overlayClientSchema,
  getValidationErrors,
  type OverlayFieldName,
  type OverlayCorners,
  type SubmissionBatchInput,
} from "@shared/validation/schemas";
import { t } from "@/locales";
import {
  getProjectValidationErrors,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { resolveOverlaySubmissionCorners } from "@/services/overlay/data";
import { applyMapSessionRows } from "@/services/map/viewportTriggers";
import { refreshUserContributions } from "@/services/project/userContributions";
import { overlayWireToData } from "@/utils/typeFactories";
import {
  PROJECT_CHANGE_FIELDS,
  type ProjectFieldChange,
  type SubmissionDraft,
} from "./submissionTypes";

interface ProposedOverlayValues {
  caption?: string | null;
  corners?: OverlayCorners;
}

interface OverlayUpdate {
  proposed: ProposedOverlayValues;
  changedFields: OverlayFieldName[];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function projectValuesEqual(
  field: ProjectFieldChange["fieldName"],
  oldValue: unknown,
  newValue: unknown,
): boolean {
  if (field === "tags" && Array.isArray(oldValue) && Array.isArray(newValue)) {
    return (
      JSON.stringify(oldValue.toSorted(compareStrings)) ===
      JSON.stringify(newValue.toSorted(compareStrings))
    );
  }
  return JSON.stringify(oldValue) === JSON.stringify(newValue);
}

function zodErrorsToMessages(zodError: Parameters<typeof getValidationErrors>[0]): string[] {
  return getValidationErrors(zodError).map((e) => t(e.key, e.params ?? {}));
}

function validateProject(project: Project): string[] {
  const errors = getProjectValidationErrors(project, { lat: project.lat, lng: project.lng });
  if (!errors) return [];
  return errors.map((e) => t(e.key, e.params ?? {}));
}

export function detectProjectChanges(project: Project): ProjectFieldChange[] {
  const projectStore = useProjectStore();
  const originalProject = projectStore.getPersistedProject(project.id);
  const draft = projectStore.projectDrafts[project.id];

  if (!originalProject || !draft) return [];

  const changes: ProjectFieldChange[] = [];
  for (const field of PROJECT_CHANGE_FIELDS) {
    if (!(field in draft)) continue;
    const oldValue = originalProject[field];
    const newValue = project[field];
    if (projectValuesEqual(field, oldValue, newValue)) continue;
    changes.push({ fieldName: field, oldValue, newValue });
  }

  return changes;
}

function validateOverlay(overlay: OverlayObject, proposed: ProposedOverlayValues): string[] {
  const corners = proposed.corners ?? resolveOverlaySubmissionCorners(overlay) ?? [];

  // filename is validated server-side only (the client may not have it yet), so it's omitted here.
  const validationData = prepareOverlayValidationData({
    id: overlay.id,
    caption: proposed.caption === undefined ? overlay.caption : proposed.caption,
    projectId: overlay.projectId,
    corners: corners.map((c: { lat: number; lng: number }) => ({ lat: c.lat, lng: c.lng })),
  });
  const result = overlayClientSchema.safeParse(validationData);
  return result.success ? [] : zodErrorsToMessages(result.error);
}

async function prepareImageForServer(overlay: OverlayObject): Promise<string> {
  if (overlay.imageUrl.startsWith("data:")) {
    const response = await fetch(overlay.imageUrl);
    const blob = await response.blob();

    // Name the file from its real type so the backend records the correct source extension
    // (it stores the pre-compression original under this extension, and a wrong .webp name on
    // PNG/JPEG bytes would mislabel a kept-as-is original).
    const type = blob.type || "image/webp";
    let extension = "webp";
    if (type === "image/png") extension = "png";
    else if (type === "image/jpeg") extension = "jpg";
    const file = new File([blob], `overlay-image.${extension}`, { type });

    return uploadImageFile(file);
  }

  const urlParts = overlay.imageUrl.split("/");
  const filename = urlParts[urlParts.length - 1];

  if (!filename) {
    throw new Error(t("overlay.publishErrorNoFilename"));
  }

  return filename;
}

async function buildSubmittedOverlay(
  overlay: OverlayObject,
  changedFields: OverlayFieldName[],
): Promise<SubmissionBatchInput["overlays"][number]> {
  if (!overlay.projectId) {
    throw new Error(t("overlay.publishErrorNoProjectId"));
  }

  const corners = resolveOverlaySubmissionCorners(overlay);
  if (!corners) {
    throw new Error(t("overlay.publishErrorNoCorners"));
  }

  const filename = await prepareImageForServer(overlay);
  return {
    id: overlay.id,
    filename,
    caption: overlay.caption,
    projectId: overlay.projectId,
    replacesOverlayId: overlay.replacesOverlayId ?? undefined,
    corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
    changedFields,
  };
}

function buildOverlayUpdate(
  mod: Pick<PendingOverlayModification, "caption" | "corners">,
): OverlayUpdate {
  const changedFields: OverlayFieldName[] = [];
  const proposed: ProposedOverlayValues = {};
  if (mod.caption) {
    changedFields.push("caption");
    proposed.caption = mod.caption.current;
  }
  if (mod.corners) {
    changedFields.push("corners");
    proposed.corners = mod.corners.current;
  }
  return { changedFields, proposed };
}

function getOverlayOrThrow(overlayId: string): OverlayObject {
  const overlay = useOverlayStore().liveOverlays[overlayId];
  if (!overlay) throw new Error(t("submission.overlayUnavailable"));
  return overlay;
}

function validateSubmission(draft: SubmissionDraft, project: Project | null): void {
  // Validate the whole batch before uploading image files or opening the backend transaction.
  const errors = new Set<string>();

  for (const mod of draft.overlayModifications) {
    const overlay = getOverlayOrThrow(mod.overlayId);
    const update = buildOverlayUpdate(mod);
    for (const error of validateOverlay(overlay, update.proposed)) errors.add(error);
  }

  for (const overlayId of draft.newOverlayIds) {
    const overlay = getOverlayOrThrow(overlayId);
    const proposed = { corners: resolveOverlaySubmissionCorners(overlay) ?? undefined };
    for (const error of validateOverlay(overlay, proposed)) errors.add(error);
  }

  if (draft.projectChanges) {
    if (!project) {
      errors.add(t("submission.projectUnavailable"));
    } else {
      for (const error of validateProject(project)) errors.add(error);
    }
  }

  if (draft.newOverlayIds.length > 0 && !project) {
    errors.add(t("overlay.publishErrorNoProject"));
  }
  if (errors.size > 0) throw new Error([...errors].join(", "));
}

async function buildSubmissionBatch(
  draft: SubmissionDraft,
  project: Project | null,
  reason: string,
): Promise<SubmissionBatchInput> {
  const overlayFields = new Map<string, OverlayFieldName[]>();
  for (const overlayId of draft.newOverlayIds) overlayFields.set(overlayId, []);

  for (const mod of draft.overlayModifications) {
    overlayFields.set(mod.overlayId, buildOverlayUpdate(mod).changedFields);
  }

  let submittedProject: SubmissionBatchInput["project"] = undefined;
  if (draft.projectChanges && project) {
    submittedProject = {
      ...projectSchema.parse(project),
      id: project.id,
      changedFields: draft.projectChanges.map(getProjectChangeField),
    };
  }

  async function buildOverlayIntent(overlayId: string) {
    return buildSubmittedOverlay(getOverlayOrThrow(overlayId), overlayFields.get(overlayId) ?? []);
  }

  const [overlays, renderFilename] = await Promise.all([
    Promise.all([...overlayFields.keys()].map(buildOverlayIntent)),
    draft.pendingRender ? uploadImageFile(draft.pendingRender.file) : undefined,
  ]);
  return {
    projectId: draft.projectId,
    project: submittedProject,
    overlays,
    render:
      draft.pendingRender && renderFilename
        ? { id: draft.pendingRender.id, filename: renderFilename }
        : undefined,
    reason,
  };
}

function getProjectChangeField(change: ProjectFieldChange) {
  return change.fieldName;
}

function applySubmissionResult(
  draft: SubmissionDraft,
  result: RouterOutput["submission"]["submit"],
): void {
  const projectStore = useProjectStore();
  const submittedOverlayIds = new Set([
    ...draft.newOverlayIds,
    ...draft.overlayModifications.map((mod) => mod.overlayId),
  ]);
  applyMapSessionRows(
    "edit",
    result.editSession.projects,
    result.editSession.overlays.map(overlayWireToData),
    submittedOverlayIds,
  );
  if (draft.projectChanges) projectStore.discardProjectDraft(draft.projectId);
  useChangeRequestStore().setPendingChangeRequests(result.changeRequests);

  if (result.render) {
    projectStore.updatePersistedProject(draft.projectId, {
      render: { filename: result.render.filename, caption: null, status: result.render.status },
    });
    clearStagedRender(draft.projectId);
  }
}

export async function submitDraft(
  draft: SubmissionDraft,
  reason: string,
): Promise<RouterOutput["submission"]["submit"]["outcome"]> {
  const project = useProjectStore().getProjectById(draft.projectId);
  validateSubmission(draft, project);
  const batch = await buildSubmissionBatch(draft, project, reason);
  const result = await trpc.submission.submit.mutate(batch);
  applySubmissionResult(draft, result);
  await refreshUserContributions();
  return result.outcome;
}
