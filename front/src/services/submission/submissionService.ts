import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { trpc, type RouterOutput } from "@/client";
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
  type SubmissionBatchInput,
} from "@shared/validation/schemas";
import { t } from "@/locales";
import {
  getProjectValidationErrors,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { applyMapSessionRows } from "@/services/map/viewportTriggers";
import { refreshUserContributions } from "@/services/project/userContributions";
import { overlayWireToData } from "@/utils/typeFactories";
import {
  PROJECT_CHANGE_FIELDS,
  type ProjectFieldChange,
  type SubmissionChangeType,
  type SubmissionDraft,
} from "./submissionTypes";

interface ProposedOverlayValues {
  caption?: string | null;
  corners?: OverlayCorners;
}

type UpdateChangeType = Exclude<SubmissionChangeType, "create">;

interface OverlayUpdate {
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

async function buildDirectOverlay(
  overlay: OverlayObject,
): Promise<SubmissionBatchInput["overlays"][number]> {
  if (!overlay.projectId) {
    throw new Error(t("overlay.publishErrorNoProjectId"));
  }

  const corners = resolveOverlayCorners(overlay, "publish");
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
  };
}

function buildOverlayUpdate(
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
    changeType: getOverlayUpdateType(overlayObj),
    changedFields,
    proposed,
  };
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
    const update = buildOverlayUpdate(mod, overlay);
    for (const error of validateOverlay(mod.overlayId, update.proposed)) errors.add(error);
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

async function buildSubmissionBatch(
  draft: SubmissionDraft,
  project: Project | null,
  reason: string,
): Promise<SubmissionBatchInput> {
  const directOverlayIds = new Set(draft.newOverlayIds);
  const changeRequests: SubmissionBatchInput["changeRequests"] = [];

  for (const mod of draft.overlayModifications) {
    const overlay = getOverlayOrThrow(mod.overlayId);
    const update = buildOverlayUpdate(mod, overlay, reason);
    if (update.changeType === "update_approved") {
      changeRequests.push({
        entityType: "overlay",
        entityId: mod.overlayId,
        changes: update.changedFields,
      });
    } else {
      directOverlayIds.add(mod.overlayId);
    }
  }

  let directProject: SubmissionBatchInput["project"] = undefined;
  if (draft.project && project) {
    if (draft.project.changeType === "update_approved") {
      changeRequests.push({
        entityType: "project",
        entityId: project.id,
        changes: draft.project.changes.map((change) => ({ ...change, changeReason: reason })),
      });
    } else {
      directProject = { ...projectSchema.parse(project), id: project.id };
    }
  }

  const [overlays, renderFilename] = await Promise.all([
    Promise.all([...directOverlayIds].map(async (id) => buildDirectOverlay(getOverlayOrThrow(id)))),
    draft.pendingRender ? uploadImageFile(draft.pendingRender.file) : undefined,
  ]);
  return {
    projectId: draft.projectId,
    project: directProject,
    overlays,
    changeRequests,
    render:
      draft.pendingRender && renderFilename
        ? { id: draft.pendingRender.id, filename: renderFilename }
        : undefined,
  };
}

function applySubmissionResult(
  draft: SubmissionDraft,
  result: RouterOutput["submission"]["submit"],
): void {
  const projectStore = useProjectStore();
  if (draft.project?.changeType === "update_approved") {
    for (const change of draft.project.changes) {
      projectStore.resetProjectField(draft.projectId, change.fieldName);
    }
  }
  if (draft.project) projectStore.updateProject(draft.projectId, { isModified: false });

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
  useChangeRequestStore().setPendingChangeRequests(result.changeRequests);

  if (result.render) {
    projectStore.updateProject(draft.projectId, {
      render: { filename: result.render.filename, caption: null, status: result.render.status },
    });
    clearStagedRender(draft.projectId);
  }
}

export async function submitDraft(draft: SubmissionDraft, reason: string): Promise<void> {
  const project = useProjectStore().getProjectById(draft.projectId);
  validateSubmission(draft, project);
  const batch = await buildSubmissionBatch(draft, project, reason);
  const result = await trpc.submission.submit.mutate(batch);
  applySubmissionResult(draft, result);
  await refreshUserContributions();
}
