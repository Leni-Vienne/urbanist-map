import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { trpc } from "@/client";
import { uploadImageFile } from "@/utils/uploadImageFile";
import { clearStagedRender } from "@/services/submission/stagedRenderState";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import type {
  Project,
  OverlayObject,
  RemovableChange,
  PendingOverlayModification,
} from "@/types/index";
import {
  projectSchema,
  overlayClientSchema,
  getValidationErrorsMap,
  type FieldChange,
  type OverlayCorners,
} from "@shared/validation/schemas";
import { t } from "@/locales";
import { refreshPendingChangeRequests } from "@/services/changes/changeRequests";
import {
  getProjectValidationErrors,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { publishOverlay, getCornersFromOverlay } from "@/services/overlay/actions";
import { usePendingModificationsStore } from "@/stores/pendingModificationsStore";
import type { SubmissionChange, SubmissionChangeType, SubmissionContext } from "./submissionTypes";

// Internal single-entity payload used by buildSummary/validate/submitEntity.
// Each public submission may produce several of these (project metadata + per-overlay updates).
type EntityUpdate =
  | {
      entityType: "project";
      entityId: string;
      changeType: SubmissionChangeType;
      entity: Project;
      changedFields?: FieldChange[];
    }
  | {
      entityType: "overlay";
      entityId: string;
      changeType: SubmissionChangeType;
      // The caption/corners this update will submit (staged delta or corners to publish).
      // When absent, validate falls back to the live store entry.
      proposed?: {
        caption?: string | null;
        corners?: OverlayCorners;
      };
      changedFields?: FieldChange[];
    };

function normalizeFieldValue(
  field: keyof Project,
  value: unknown,
  projectSource: Partial<Project>,
): unknown {
  const fieldStr = field;
  if (["proposalDate", "startDate", "endDate"].includes(fieldStr)) {
    return normalizeDate(value);
  }
  if (fieldStr === "geometry") {
    return hasShapes(value) ? JSON.stringify(value) : null;
  }
  if (getPrecisionDateField(field) !== null) {
    return normalizeDatePrecision(field, value, projectSource);
  }
  if (fieldStr === "tags") {
    return JSON.stringify(
      // oxlint-disable-next-line no-unsafe-type-assertion
      Array.isArray(value) ? (value as string[]).toSorted((a, b) => a.localeCompare(b)) : [],
    );
  }
  return value === "" ? null : (value ?? null);
}

function hasShapes(v: unknown): boolean {
  return (
    v !== null &&
    v !== undefined &&
    typeof v === "object" &&
    // oxlint-disable-next-line no-unsafe-type-assertion
    (v as GeoJSON.GeometryCollection).geometries.length > 0
  );
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

function normalizeDatePrecision(
  field: keyof Project,
  precisionValue: unknown,
  projectValueSource: Partial<Project>,
): unknown {
  const dateField = getPrecisionDateField(field);
  if (!dateField) {
    return precisionValue ?? null;
  }

  const dateValue = projectValueSource[dateField];
  if (!dateValue) {
    return precisionValue ?? null;
  }

  return precisionValue === null || precisionValue === undefined ? "day" : precisionValue;
}

function zodErrorsToMessages(zodError: Parameters<typeof getValidationErrorsMap>[0]): string[] {
  const zodErrors = getValidationErrorsMap(zodError);
  return Object.values(zodErrors).map((e) => t(e.key, e.params ?? {}));
}

function validateProject(project: Project): string[] {
  const errors = getProjectValidationErrors(project, { lat: project.lat, lng: project.lng });
  if (!errors) return [];
  return Object.values(errors).map((e) => t(e.key, e.params ?? {}));
}

function getChangeType(entity: Project | OverlayObject): SubmissionChangeType {
  if (entity.status === "pending" || entity.status === "rejected") {
    return "update_pending";
  }

  if (entity.status === "approved") {
    return "update_approved";
  }

  return "create";
}

function newOverlayContext(
  overlayId: string,
  overlayObj: OverlayObject,
): Extract<EntityUpdate, { entityType: "overlay" }> {
  return {
    entityType: "overlay",
    entityId: overlayId,
    changeType: "create",
    proposed: {
      corners: getCornersFromOverlay(overlayObj) ?? undefined,
    },
  };
}

// Empty values format to "" so the dialog template applies its own no-value placeholder/styling.
function formatValueForDisplay(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (fieldName === "geometry" && typeof value === "object") {
    // oxlint-disable-next-line no-unsafe-type-assertion
    const count = (value as GeoJSON.GeometryCollection).geometries.length;
    return t("shapes.geometrySummary", { count });
  }

  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function createProjectContext(
  project: Project,
  changeType?: SubmissionChangeType,
): Extract<EntityUpdate, { entityType: "project" }> {
  return {
    entityType: "project",
    entityId: project.id,
    entity: project,
    changeType: changeType ?? getChangeType(project),
  };
}

function detectProjectChanges(project: Project, customReason?: string): FieldChange[] {
  const changes: FieldChange[] = [];
  const originalProject = useProjectStore().getOriginalProject(project.id);

  if (!originalProject) return changes;

  const fieldsToCheck: (keyof Project)[] = [
    "name",
    "description",
    "sourceUrl",
    "timelineStatus",
    "proposalDate",
    "startDate",
    "endDate",
    "endDatePrecision",
    "proposalDatePrecision",
    "startDatePrecision",
    "geometry",
    "tags",
  ];

  for (const field of fieldsToCheck) {
    // oxlint-disable-next-line no-unsafe-type-assertion
    const oldValue = (originalProject as unknown as Record<string, unknown>)[field];
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
        changeReason: customReason,
      });
    }
  }

  return changes;
}

// Build human-readable formatted changes for confirmation dialog
export function formatEntityChanges(
  context: Extract<EntityUpdate, { entityType: "project" }>,
): SubmissionChange[] {
  return detectProjectChanges(context.entity).map((change) => ({
    // oxlint-disable-next-line no-unsafe-type-assertion
    field: change.fieldName as RemovableChange,
    oldValue: formatValueForDisplay(change.oldValue, change.fieldName),
    newValue: formatValueForDisplay(change.newValue, change.fieldName),
    displayLabel: t(`fields.${change.fieldName}`),
  }));
}

function validateOverlay(context: Extract<EntityUpdate, { entityType: "overlay" }>): string[] {
  const liveOverlay = useOverlayStore().liveOverlays[context.entityId];
  const corners =
    context.proposed?.corners ??
    getOverlayImageCorners(context.entityId) ??
    liveOverlay?.baselineCorners ??
    [];

  // filename is validated server-side only (the client may not have it yet), so it's omitted here.
  const validationData = prepareOverlayValidationData({
    id: context.entityId,
    caption: context.proposed?.caption ?? liveOverlay?.caption ?? null,
    projectId: liveOverlay?.projectId ?? null,
    corners: corners.map((c: { lat: number; lng: number }) => ({ lat: c.lat, lng: c.lng })),
  });
  const result = overlayClientSchema.safeParse(validationData);
  return result.success ? [] : zodErrorsToMessages(result.error);
}

function validate(context: EntityUpdate): string[] {
  const errors =
    context.entityType === "project" ? validateProject(context.entity) : validateOverlay(context);

  if (context.changeType !== "create" && (context.changedFields ?? []).length === 0) {
    errors.push(t("errors.noChangesDetected"));
  }

  return errors;
}

async function submitProjectChangeRequest(project: Project, changes: FieldChange[]): Promise<void> {
  await trpc.changes.submitChangeRequest.mutate({
    entityType: "project",
    entityId: project.id,
    changes,
  });

  useProjectStore().updateProject(project.id, { isModified: false });

  await refreshPendingChangeRequests({ force: true });
}

// Local store + UI sync after a successful project publish: status flip, baseline cache,
// marker add/recolor, and contributions-sidebar entry. Kept together so callers don't have
// to remember the full cascade.
function applyOptimisticPublishedProject(project: Project, changeType: SubmissionChangeType): void {
  const projectStore = useProjectStore();
  projectStore.updateProject(project.id, { isModified: false, status: "pending" });
  projectStore.cacheProjectBackendState(project.id);

  const updated = projectStore.projects[project.id];
  if (!updated) return;

  if (changeType === "create") {
    projectStore.addProjectToUserContributions(updated);
    return;
  }

  if (changeType === "update_pending") {
    projectStore.updateProjectInUserContributions(project.id, {
      name: project.name,
      description: project.description,
      sourceUrl: project.sourceUrl,
      updatedAt: new Date(),
    });
  }
}

async function publishProjectDirect(
  project: Project,
  changeType: SubmissionChangeType,
): Promise<void> {
  await trpc.project.publishProject.mutate(projectSchema.parse(project));
  applyOptimisticPublishedProject(project, changeType);
}

async function submitProject(
  context: Extract<EntityUpdate, { entityType: "project" }>,
  changes: FieldChange[],
): Promise<void> {
  if (context.changeType === "update_approved") {
    await submitProjectChangeRequest(context.entity, changes);
  } else {
    await publishProjectDirect(context.entity, context.changeType);
  }
}

async function submitOverlay(
  overlayId: string,
  changeType: SubmissionChangeType,
  changes: FieldChange[],
): Promise<void> {
  const overlayStore = useOverlayStore();

  if (changeType === "create") {
    throw new Error("New overlay creation should use publishOverlay directly");
  }

  if (changeType === "update_approved") {
    if (changes.length === 0) throw new Error(t("errors.noChangesDetected"));
    await trpc.changes.submitChangeRequest.mutate({
      entityType: "overlay",
      entityId: overlayId,
      changes,
    });

    const cornersChange = changes.find((c) => c.fieldName === "corners");
    const updates: Partial<OverlayObject> = {
      hasPendingChanges: true,
    };
    if (cornersChange?.newValue) {
      // suggestedCorners powers the "view suggested position" preview; flipping
      // isViewingApprovedPosition turns the marker yellow while the CR is open.
      // oxlint-disable-next-line no-unsafe-type-assertion
      updates.suggestedCorners = cornersChange.newValue as OverlayCorners;
      updates.isViewingApprovedPosition = false;
    }
    overlayStore.updateOverlay(overlayId, updates);

    await refreshPendingChangeRequests({ force: true });
    return;
  }

  // changeType === "update_pending"
  const hasCornersChange = changes.some((c) => c.fieldName === "corners");
  if (hasCornersChange) {
    // Pass the live store entry so publishOverlay's status/imageUrl mutations land in the store.
    const liveOverlay = overlayStore.liveOverlays[overlayId];
    if (!liveOverlay) return;

    const project = liveOverlay.projectId
      ? useProjectStore().getProjectById(liveOverlay.projectId)
      : null;
    await publishOverlay(liveOverlay, project);
    return;
  }

  // Caption-only update on a pending overlay.
  const overlayData: { id: string; caption?: string } = { id: overlayId };
  const captionChange = changes.find((c) => c.fieldName === "caption");
  if (captionChange) {
    overlayData.caption = String(captionChange.newValue ?? "");
  }
  await trpc.overlay.updateOverlay.mutate(overlayData);

  if (overlayData.caption !== undefined) {
    useProjectStore().updateOverlayInUserContributions(overlayId, {
      caption: overlayData.caption,
    });
  }
}

// Executes one already-validated entity update. submitContext validates the whole batch up
// front, so this never re-validates (re-validating here would double-check every overlay edit).
async function submitEntity(context: EntityUpdate): Promise<void> {
  const changes = context.changedFields ?? [];

  if (context.entityType === "project") {
    await submitProject(context, changes);
  } else {
    await submitOverlay(context.entityId, context.changeType, changes);
  }
}

// Builds the overlay update context (changed fields + proposed values) from a staged
// modification. Shared by the validation pass and the write pass so both see the same payload.
function buildOverlayModificationContext(
  overlayId: string,
  mod: Pick<PendingOverlayModification, "caption" | "corners">,
  overlayObj: OverlayObject,
  reason?: string,
): Extract<EntityUpdate, { entityType: "overlay" }> {
  const changedFields: FieldChange[] = [];
  const proposed: { caption?: string | null; corners?: OverlayCorners } = {};
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
    entityType: "overlay",
    entityId: overlayId,
    changeType: getChangeType(overlayObj),
    changedFields,
    proposed,
  };
}

// Submit a single overlay modification (used for both allProjectModifications and pendingOverlayModifications).
async function submitOverlayModification(
  overlayId: string,
  mod: Pick<PendingOverlayModification, "caption" | "corners">,
  reason: string,
): Promise<void> {
  const overlayStore = useOverlayStore();
  const overlayObj = overlayStore.liveOverlays[overlayId];
  if (!overlayObj) return;

  const isChangeRequest = overlayObj.status === "approved";

  await submitEntity(buildOverlayModificationContext(overlayId, mod, overlayObj, reason));

  usePendingModificationsStore().clearModification(overlayId);

  // For direct updates we collapse history so the submitted state is the new baseline;
  // change requests keep history so the proposal stays visible on edit-mode re-entry.
  const submittedCorners = mod.corners?.current;
  if (submittedCorners && !isChangeRequest) {
    overlayStore.updateOverlay(overlayId, { baselineCorners: submittedCorners });
    overlayStore.resetHistoryBaseline(overlayId, submittedCorners);
  }
}

async function publishNewOverlays(overlayIds: string[], project: Project | null): Promise<void> {
  const overlayStore = useOverlayStore();
  for (const overlayId of overlayIds) {
    const overlayObj = overlayStore.liveOverlays[overlayId];
    if (!overlayObj) continue;
    await publishOverlay(overlayObj, project);
    // Collapse history so the just-published state is the new baseline.
    const publishedState = overlayObj.history.at(-1);
    if (publishedState) {
      overlayStore.updateOverlay(overlayId, { baselineCorners: publishedState.corners });
      overlayStore.resetHistoryBaseline(overlayId, publishedState.corners);
    }
  }
}

// Publish a render staged in the project form. Its own moderated entity, attached to an
// existing project row, so callers must ensure the project is published first.
async function publishStagedRender(projectId: string, file: File): Promise<void> {
  const projectStore = useProjectStore();
  const filename = await uploadImageFile(file);
  const created = await trpc.overlay.publishRender.mutate({ projectId, filename });
  // Optimistically attach the pending render so the detail panel shows it immediately in edit mode.
  // Clear isModified too: a render-only edit marks the project modified but submits nothing
  // through the project change paths, so nothing else resets the flag.
  projectStore.updateProject(projectId, {
    render: { filename, caption: null, status: "pending" },
    isModified: false,
  });
  // Mirror it into My Contributions, where renders show as render-kind overlays in the list.
  projectStore.addRenderToUserContributions(
    projectId,
    { id: created.id, filename, status: created.status, authorId: created.authorId },
    useAuthStore().user?.username ?? null,
  );
  clearStagedRender(projectId);
}

// Overlay contexts the batch will submit (edits + new overlays). Overlays missing from the store
// are skipped here exactly as the write steps skip them, so they never raise a spurious error.
function collectOverlayContexts(
  existingMods: PendingOverlayModification[],
  newOverlayIds: string[],
): EntityUpdate[] {
  const overlayStore = useOverlayStore();
  const edits = existingMods.flatMap((mod) => {
    const overlayObj = overlayStore.liveOverlays[mod.overlayId];
    return overlayObj ? [buildOverlayModificationContext(mod.overlayId, mod, overlayObj)] : [];
  });
  const created = newOverlayIds.flatMap((id) => {
    const overlayObj = overlayStore.liveOverlays[id];
    return overlayObj ? [newOverlayContext(id, overlayObj)] : [];
  });
  return [...edits, ...created];
}

// Project metadata change and brand-new project are mutually exclusive (status set vs null);
// a single context drives both validation and the write. detectProjectChanges runs once here and
// is threaded through as changedFields so validate/submitEntity don't recompute it.
function buildProjectContext(
  ctx: SubmissionContext,
  project: Project | null,
  newOverlayIds: string[],
  reason: string,
): Extract<EntityUpdate, { entityType: "project" }> | null {
  if (!project) return null;
  const projectChanges = detectProjectChanges(project, reason);
  if (project.status === null && newOverlayIds.length === 0) {
    return { ...createProjectContext(project, "create"), changedFields: projectChanges };
  }
  if (ctx.projectModified && project.status !== null && projectChanges.length) {
    return { ...createProjectContext(project), changedFields: projectChanges };
  }
  return null;
}

export async function submitContext(ctx: SubmissionContext, reason: string): Promise<void> {
  const project = ctx.projectId ? useProjectStore().getProjectById(ctx.projectId) : null;
  const newOverlayIds = ctx.newOverlayIds ?? [];
  const existingMods = ctx.existingOverlayModifications ?? [];

  const projectContext = buildProjectContext(ctx, project, newOverlayIds, reason);

  // Validate the whole batch before any write, so a later failure can't leave an earlier
  // change already persisted.
  const contexts = collectOverlayContexts(existingMods, newOverlayIds);
  if (projectContext) contexts.push(projectContext);
  const errors = new Set(contexts.flatMap((context) => validate(context)));
  // New overlays need their project object loaded so publishOverlay can create/reference it.
  if (newOverlayIds.length > 0 && !project) errors.add(t("overlay.publishErrorNoProject"));
  // A new project bundled with overlays gets no project context (publishOverlay publishes it
  // via ensureProjectOnServer), so its metadata is validated here to keep it in the batch check.
  if (project?.status === null && newOverlayIds.length > 0) {
    for (const error of validateProject(project)) errors.add(error);
  }
  if (errors.size > 0) throw new Error([...errors].join(", "));

  // Writes run only after the whole batch validated.
  for (const mod of existingMods) {
    await submitOverlayModification(mod.overlayId, mod, reason);
  }
  await publishNewOverlays(newOverlayIds, project);
  if (projectContext) {
    await submitEntity(projectContext);
  }
  if (ctx.pendingRender && ctx.projectId) {
    await publishStagedRender(ctx.projectId, ctx.pendingRender.file);
  }
}
