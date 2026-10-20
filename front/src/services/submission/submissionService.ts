import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { trpc, type RouterOutput } from "@/client";
import { uploadImageFile } from "@/services/submission/uploadImageFile";
import { useAuthStore } from "@/stores/authStore";
import { isSubmitting } from "./submissionState";
import type { Project, OverlayObject, PendingOverlayModification } from "@/types/index";
import {
  projectSchema,
  projectPatchSchema,
  validateProjectPatch,
  overlayClientSchema,
  getValidationErrors,
  type OverlayFieldName,
  type OverlayCorners,
  type SubmissionBatchInput,
  type ProjectPatch,
} from "@shared/validation/schemas";
import { t } from "@/locales";
import {
  getProjectValidationErrors,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { resolveOverlaySubmissionCorners } from "@/services/overlay/data";
import { acknowledgeSubmission } from "./submissionReceipt";
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

function validateProject(project: Project, changes: ProjectFieldChange[]): string[] {
  if (project.status !== null) {
    const result = validateProjectPatch(buildProjectPatch(changes), project);
    return result.success ? [] : zodErrorsToMessages(result.error);
  }
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
    changes.push(
      field === "geometry"
        ? { fieldName: field, oldValue: originalProject.geometry, newValue: project.geometry }
        : { fieldName: field, oldValue: originalProject[field], newValue: project[field] },
    );
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
    const store = useOverlayStore();
    const uploaded = store.overlayDrafts[overlay.id]?.uploadedImage;
    if (uploaded?.imageUrl === overlay.imageUrl) return uploaded.filename;
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

    const filename = await uploadImageFile(file);
    store.rememberUploadedImage(overlay.id, overlay.imageUrl, filename);
    return filename;
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
      for (const error of validateProject(project, draft.projectChanges)) errors.add(error);
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
    submittedProject =
      project.status === null
        ? { id: project.id, create: projectSchema.parse(project) }
        : { id: project.id, patch: buildProjectPatch(draft.projectChanges) };
  }

  async function buildOverlayIntent(overlayId: string) {
    const overlay = getOverlayOrThrow(overlayId);
    return buildSubmittedOverlay(overlay, overlayFields.get(overlayId) ?? []);
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

function buildProjectPatch(changes: ProjectFieldChange[]) {
  const patch: ProjectPatch = {};
  for (const change of changes) Object.assign(patch, { [change.fieldName]: change.newValue });
  return projectPatchSchema.parse(patch);
}

export async function submitDraft(
  draft: SubmissionDraft,
  reason: string,
): Promise<RouterOutput["submission"]["submit"]["outcome"]> {
  if (isSubmitting.value) throw new Error(t("errors.submissionFailed"));
  isSubmitting.value = true;
  try {
    const projectStore = useProjectStore();
    const authStore = useAuthStore();
    const epoch = authStore.getSessionEpoch();
    const userId = authStore.user?.id;
    const project = projectStore.getProjectById(draft.projectId);
    validateSubmission(draft, project);
    const batch = await buildSubmissionBatch(draft, project, reason);
    if (epoch !== authStore.getSessionEpoch() || userId !== authStore.user?.id) {
      throw new Error(t("errors.submissionFailed"));
    }
    const result = await trpc.submission.submit.mutate(batch);
    if (epoch === authStore.getSessionEpoch() && userId === authStore.user?.id) {
      acknowledgeSubmission(result, batch);
    }
    return result.outcome;
  } finally {
    isSubmitting.value = false;
  }
}
