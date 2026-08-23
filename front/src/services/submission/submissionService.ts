import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { getApiUrl } from "@/utils/apiUrl";
import { parseShapeCollection } from "@/utils/geojson";
import { uploadImageFile } from "@/services/submission/uploadImageFile";
import { clearStagedRender } from "@/services/submission/stagedRenderState";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import type { Project, OverlayObject, PendingOverlayModification } from "@/types/index";
import {
  projectSchema,
  overlayClientSchema,
  getValidationErrors,
  type FieldChange,
  type OverlayCorners,
} from "@shared/validation/schemas";
import { t } from "@/locales";
import { refreshPendingChangeRequests } from "@/services/changes/changeRequests";
import {
  getProjectValidationErrors,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { applyOverlayBackendFields, type OverlayBackendFields } from "@/services/overlay/sync";
import { refreshMapSessionData } from "@/services/map/viewportTriggers";
import {
  PROJECT_CHANGE_FIELDS,
  type ProjectFieldChange,
  type ProjectSubmissionDraft,
  type SubmissionChangeType,
  type SubmissionDraft,
} from "./submissionTypes";

interface ProposedOverlayValues {
  caption?: string | null;
  corners?: OverlayCorners;
}

type UpdateChangeType = Exclude<SubmissionChangeType, "create">;

interface OverlayUpdate {
  overlayId: string;
  changeType: UpdateChangeType;
  proposed: ProposedOverlayValues;
  changedFields: FieldChange[];
}

function normalizeFieldValue(
  field: keyof Project,
  value: unknown,
  projectSource: Partial<Project>,
): unknown {
  if (["proposalDate", "startDate", "endDate"].includes(field)) {
    return normalizeDate(value);
  }
  if (field === "geometry") {
    const shapes = parseShapeCollection(value);
    return shapes ? JSON.stringify(shapes) : null;
  }
  const precisionDateField = getPrecisionDateField(field);
  if (precisionDateField) {
    return normalizeDatePrecision(precisionDateField, value, projectSource);
  }
  if (field === "tags") {
    return JSON.stringify(
      // oxlint-disable-next-line no-unsafe-type-assertion
      Array.isArray(value) ? (value as string[]).toSorted((a, b) => a.localeCompare(b)) : [],
    );
  }
  return value === "" ? null : (value ?? null);
}

function normalizeDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0] ?? null;
  if (typeof val === "string") return val.split("T")[0] ?? null;
  return null;
}

function getPrecisionDateField(field: keyof Project): keyof Project | null {
  switch (field) {
    case "proposalDatePrecision":
      return "proposalDate";
    case "startDatePrecision":
      return "startDate";
    case "endDatePrecision":
      return "endDate";
    default:
      return null;
  }
}

// A precision only means something next to a date: with no date set, the precision stays as-is,
// otherwise a missing precision defaults to "day".
function normalizeDatePrecision(
  dateField: keyof Project,
  precisionValue: unknown,
  projectValueSource: Partial<Project>,
): unknown {
  const dateValue = projectValueSource[dateField];
  if (dateValue === null || dateValue === undefined || dateValue === "") {
    return precisionValue ?? null;
  }

  return precisionValue === null || precisionValue === undefined ? "day" : precisionValue;
}

function zodErrorsToMessages(zodError: Parameters<typeof getValidationErrors>[0]): string[] {
  return getValidationErrors(zodError).map((e) => t(e.key, e.params ?? {}));
}

function validateProject(project: Project): string[] {
  const errors = getProjectValidationErrors(project, { lat: project.lat, lng: project.lng });
  if (!errors) return [];
  return errors.map((e) => t(e.key, e.params ?? {}));
}

function getOverlayUpdateType(overlay: OverlayObject): UpdateChangeType {
  return overlay.status === "approved" ? "update_approved" : "update_pending";
}

export function detectProjectChanges(project: Project): ProjectFieldChange[] {
  const changes: ProjectFieldChange[] = [];
  const originalProject = useProjectStore().getOriginalProject(project.id);

  if (!originalProject) return changes;

  for (const field of PROJECT_CHANGE_FIELDS) {
    const oldValue = originalProject[field];
    const newValue = project[field];

    const isGeometryField = field === "geometry";
    const isArrayField = field === "tags";

    const normalizedOld = normalizeFieldValue(field, oldValue, originalProject);
    const normalizedNew = normalizeFieldValue(field, newValue, project);

    if (normalizedOld !== normalizedNew) {
      // Store raw objects for geometry/arrays so the backend receives proper JSON, not a string
      let pushedOldValue: unknown = normalizedOld;
      let pushedNewValue: unknown = normalizedNew;
      if (isGeometryField) {
        pushedOldValue = normalizedOld !== null ? oldValue : null;
        pushedNewValue = normalizedNew !== null ? newValue : null;
      } else if (isArrayField) {
        pushedOldValue = oldValue;
        pushedNewValue = newValue;
      }
      changes.push({
        fieldName: field,
        oldValue: pushedOldValue,
        newValue: pushedNewValue,
      });
    }
  }

  return changes;
}

function validateOverlay(overlayId: string, proposed: ProposedOverlayValues): string[] {
  const liveOverlay = useOverlayStore().liveOverlays[overlayId];
  const corners =
    proposed.corners ?? getOverlayImageCorners(overlayId) ?? liveOverlay?.baselineCorners ?? [];

  // filename is validated server-side only (the client may not have it yet), so it's omitted here.
  const validationData = prepareOverlayValidationData({
    id: overlayId,
    caption: proposed.caption ?? liveOverlay?.caption ?? null,
    projectId: liveOverlay?.projectId ?? null,
    corners: corners.map((c: { lat: number; lng: number }) => ({ lat: c.lat, lng: c.lng })),
  });
  const result = overlayClientSchema.safeParse(validationData);
  return result.success ? [] : zodErrorsToMessages(result.error);
}

function validateChangedFields(
  changeType: SubmissionChangeType,
  changedFields: FieldChange[],
): string[] {
  const errors: string[] = [];
  if (changeType !== "create" && changedFields.length === 0) {
    errors.push(t("errors.noChangesDetected"));
  }
  return errors;
}

function applyOptimisticPublishedProject(project: Project, changeType: SubmissionChangeType): void {
  const projectStore = useProjectStore();
  projectStore.updateProject(project.id, {
    isModified: false,
    status: "pending",
    ...(changeType === "update_pending" && {
      name: project.name,
      description: project.description,
      sourceUrl: project.sourceUrl,
      updatedAt: new Date(),
    }),
  });
  projectStore.cacheProjectBackendState(project.id);

  const updated = projectStore.projects[project.id];
  if (!updated) return;

  if (changeType === "create") projectStore.addProjectToUserContributions(updated);
}

async function submitProject(
  project: Project,
  draft: ProjectSubmissionDraft,
  reason: string,
): Promise<void> {
  if (draft.changeType === "update_approved") {
    await trpc.changes.submitChangeRequest.mutate({
      entityType: "project",
      entityId: project.id,
      changes: draft.changes.map((change) => ({ ...change, changeReason: reason })),
    });
    useProjectStore().updateProject(project.id, { isModified: false });
    return;
  }

  await trpc.project.publishProject.mutate(projectSchema.parse(project));
  applyOptimisticPublishedProject(project, draft.changeType);
}

// Resolve the stored filename for the overlay's image: upload a local data-URL image (local
// storage first, R2 after moderator approval), or reuse the filename from an existing server URL.
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

function handlePostPublishUpdates(
  overlay: OverlayObject,
  project: Project | null,
  filename: string,
): void {
  if (!project) return;

  const projectStore = useProjectStore();
  const existingOverlays = Object.values(useOverlayStore().liveOverlays).filter(
    (o) => o.projectId === project.id && o.id !== overlay.id,
  );
  projectStore.addOverlayToUserContributions(
    overlay,
    project,
    filename,
    useAuthStore().user?.username ?? null,
    existingOverlays,
  );
}

async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
  if (!overlay.projectId) {
    throw new Error(t("overlay.publishErrorNoProjectId"));
  }

  const corners = resolveOverlayCorners(overlay, "publish");
  if (!corners) {
    throw new Error(t("overlay.publishErrorNoCorners"));
  }

  const filename = await prepareImageForServer(overlay);

  const payload = {
    id: overlay.id,
    filename,
    caption: overlay.caption ?? undefined,
    projectId: overlay.projectId,
    replacesOverlayId: overlay.replacesOverlayId ?? undefined,
    corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
  };

  const publishResult = await trpc.overlay.publishOverlay.mutate(payload);

  useOverlayStore().updateOverlay(overlay.id, {
    status: publishResult.status,
    authorId: publishResult.authorId ?? null,
    // Point to the server URL so the image isn't re-uploaded on the next save.
    // The backend serves uploads under /uploads/ (no /api/images endpoint exists).
    imageUrl: `${getApiUrl()}/uploads/${filename}`,
    filename,
  });

  handlePostPublishUpdates(overlay, project, filename);
}

async function submitOverlay(
  overlayId: string,
  changeType: UpdateChangeType,
  changes: FieldChange[],
): Promise<void> {
  if (changeType === "update_approved") {
    if (changes.length === 0) throw new Error(t("errors.noChangesDetected"));
    await trpc.changes.submitChangeRequest.mutate({
      entityType: "overlay",
      entityId: overlayId,
      changes,
    });

    const cornersChange = changes.find((c) => c.fieldName === "corners");
    const captionChange = changes.find((c) => c.fieldName === "caption");
    const overlayObject = getOverlayOrThrow(overlayId);
    // Fields absent from the request stay untouched: applyOverlayBackendFields writes every key
    // it is handed, so an undefined one would clear the overlay's current value.
    const fields: OverlayBackendFields = { hasPendingChanges: true };
    if (cornersChange?.newValue) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      fields.suggestedCorners = cornersChange.newValue as OverlayCorners;
    }
    if (captionChange) fields.suggestedCaption = String(captionChange.newValue ?? "");
    applyOverlayBackendFields(overlayObject, fields);
    return;
  }

  // changeType === "update_pending"
  const hasCornersChange = changes.some((c) => c.fieldName === "corners");
  if (hasCornersChange) {
    // Pass the live store entry so publishOverlay's status/imageUrl mutations land in the store.
    const liveOverlay = getOverlayOrThrow(overlayId);

    const project = liveOverlay.projectId
      ? useProjectStore().getProjectById(liveOverlay.projectId)
      : null;
    await publishOverlay(liveOverlay, project);
    return;
  }

  // Caption-only update on a pending overlay.
  const captionChange = changes.find((c) => c.fieldName === "caption");
  const caption = captionChange ? String(captionChange.newValue ?? "") : undefined;
  await trpc.overlay.updateOverlay.mutate({ id: overlayId, caption });

  if (caption !== undefined) {
    const projectId = getOverlayOrThrow(overlayId).projectId;
    if (projectId) {
      useProjectStore().updateOverlayInUserContributions(projectId, overlayId, { caption });
    }
  }
}

function buildOverlayUpdate(
  overlayId: string,
  mod: Pick<PendingOverlayModification, "caption" | "corners">,
  overlayObj: OverlayObject,
  reason?: string,
): OverlayUpdate {
  const changedFields: FieldChange[] = [];
  const proposed: ProposedOverlayValues = {};
  if (mod.caption) {
    changedFields.push({
      fieldName: "caption",
      oldValue: mod.caption.original,
      newValue: mod.caption.current,
      changeReason: reason,
    });
    proposed.caption = mod.caption.current;
  }
  if (mod.corners) {
    changedFields.push({
      fieldName: "corners",
      oldValue: mod.corners.original,
      newValue: mod.corners.current,
      changeReason: reason,
    });
    proposed.corners = mod.corners.current;
  }
  return {
    overlayId,
    changeType: getOverlayUpdateType(overlayObj),
    changedFields,
    proposed,
  };
}

// Submit a single overlay modification.
async function submitOverlayModification(
  overlayId: string,
  mod: Pick<PendingOverlayModification, "caption" | "corners">,
  reason: string,
): Promise<boolean> {
  const overlayStore = useOverlayStore();
  const overlayObj = getOverlayOrThrow(overlayId);

  const isChangeRequest = overlayObj.status === "approved";
  const update = buildOverlayUpdate(overlayId, mod, overlayObj, reason);
  await submitOverlay(update.overlayId, update.changeType, update.changedFields);

  // Collapse history to the submitted position. Direct updates also move baselineCorners; a change
  // request's baseline stays the approved corners and the submitted position becomes the
  // suggestedCorners default (set by submitOverlay's update_approved branch).
  const submittedCorners = mod.corners?.current;
  if (submittedCorners) {
    if (!isChangeRequest) {
      overlayStore.updateOverlay(overlayId, { baselineCorners: submittedCorners });
    }
    overlayStore.resetHistoryBaseline(overlayId, submittedCorners);
  }

  // Move baselineCaption to the submitted value on a direct update so the staged test goes false.
  // A change request's baseline stays the approved caption; suggestedCaption is the new default.
  const submittedCaption = mod.caption?.current;
  if (submittedCaption !== undefined && !isChangeRequest) {
    overlayStore.updateOverlay(overlayId, { baselineCaption: submittedCaption });
  }

  return isChangeRequest;
}

async function publishNewOverlay(overlayId: string, project: Project | null): Promise<void> {
  const overlayStore = useOverlayStore();
  const overlayObj = getOverlayOrThrow(overlayId);

  await publishOverlay(overlayObj, project);

  // Collapse history so the just-published state is the new baseline, and snapshot the published
  // caption as the baseline so the just-published overlay reads as clean.
  const publishedState = overlayObj.history.at(-1);
  if (publishedState) {
    overlayStore.updateOverlay(overlayId, {
      baselineCorners: publishedState.corners,
      baselineCaption: overlayObj.caption,
    });
    overlayStore.resetHistoryBaseline(overlayId, publishedState.corners);
  }
}

// Publish a render staged in the project form. Its own moderated entity, attached to an
// existing project row, so callers must ensure the project is published first.
async function publishStagedRender(projectId: string, file: File): Promise<void> {
  const projectStore = useProjectStore();
  const filename = await uploadImageFile(file);
  const created = await trpc.overlay.publishRender.mutate({ projectId, filename });
  // Optimistically attach the pending render so the detail panel shows it immediately in edit mode.
  projectStore.updateProject(projectId, {
    render: { filename, caption: null, status: "pending" },
  });
  // Mirror it into My Contributions, where renders show as render-kind overlays in the list.
  projectStore.addRenderToUserContributions(
    projectId,
    { id: created.id, filename, status: created.status, authorId: created.authorId },
    useAuthStore().user?.username ?? null,
  );
  clearStagedRender(projectId);
}

function getOverlayOrThrow(overlayId: string): OverlayObject {
  const overlay = useOverlayStore().liveOverlays[overlayId];
  if (!overlay) throw new Error(t("submission.overlayUnavailable"));
  return overlay;
}

function validateSubmission(draft: SubmissionDraft, project: Project | null): void {
  // Validate the whole batch before any write so deterministic client errors do not cause a
  // partial submission. Server and network failures can still interrupt the writes below.
  const errors = new Set<string>();

  for (const mod of draft.overlayModifications) {
    const overlay = getOverlayOrThrow(mod.overlayId);
    const update = buildOverlayUpdate(mod.overlayId, mod, overlay);
    for (const error of validateOverlay(update.overlayId, update.proposed)) errors.add(error);
    for (const error of validateChangedFields(update.changeType, update.changedFields)) {
      errors.add(error);
    }
  }

  for (const overlayId of draft.newOverlayIds) {
    const overlay = getOverlayOrThrow(overlayId);
    const proposed = { corners: resolveOverlayCorners(overlay, "publish") ?? undefined };
    for (const error of validateOverlay(overlayId, proposed)) errors.add(error);
  }

  if (draft.project) {
    if (!project) {
      errors.add(t("submission.projectUnavailable"));
    } else {
      for (const error of validateProject(project)) errors.add(error);
      for (const error of validateChangedFields(draft.project.changeType, draft.project.changes)) {
        errors.add(error);
      }
    }
  }

  if (draft.newOverlayIds.length > 0 && !project) {
    errors.add(t("overlay.publishErrorNoProject"));
  }
  if (errors.size > 0) throw new Error([...errors].join(", "));
}

export async function submitDraft(draft: SubmissionDraft, reason: string): Promise<void> {
  const project = useProjectStore().getProjectById(draft.projectId);
  const projectDraft = draft.project;
  const overlayModifications = [...draft.overlayModifications];
  const newOverlayIds = [...draft.newOverlayIds];

  validateSubmission(draft, project);

  let shouldRefreshChangeRequests = false;
  let shouldRefreshMapSession = false;

  try {
    // A new project is the foreign-key prerequisite for its overlays and render.
    if (projectDraft?.changeType === "create" && project) {
      await submitProject(project, projectDraft, reason);
      draft.project = undefined;
    }

    // Each completed entity is dropped from the draft. After a later failure, a retry starts at
    // the remaining work. A lost response can still leave the server ahead of this local draft.
    for (const mod of overlayModifications) {
      const submittedChangeRequest = await submitOverlayModification(mod.overlayId, mod, reason);
      if (submittedChangeRequest) {
        shouldRefreshChangeRequests = true;
        shouldRefreshMapSession = true;
      }
      draft.overlayModifications = draft.overlayModifications.filter(
        (pending) => pending.overlayId !== mod.overlayId,
      );
    }

    for (const overlayId of newOverlayIds) {
      await publishNewOverlay(overlayId, project);
      draft.newOverlayIds = draft.newOverlayIds.filter((id) => id !== overlayId);
    }

    if (projectDraft && projectDraft.changeType !== "create" && project) {
      await submitProject(project, projectDraft, reason);
      if (projectDraft.changeType === "update_approved") {
        shouldRefreshChangeRequests = true;
      }
      draft.project = undefined;
    }

    if (draft.pendingRender) {
      await publishStagedRender(draft.projectId, draft.pendingRender.file);
      draft.pendingRender = undefined;
    }
  } finally {
    if (shouldRefreshChangeRequests) {
      await refreshPendingChangeRequests({ force: true });
    }
    if (shouldRefreshMapSession) {
      await refreshMapSessionData();
    }
  }
}
