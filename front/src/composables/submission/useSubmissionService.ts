import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { trpc } from "@/client";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";
import {
  addStandaloneProjectMarkerForProject,
  updateStandaloneProjectMarkerColor,
} from "@/services/map/standaloneProjectMarkers";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import type { Project, OverlayObject, RemovableChange } from "@/types/index";
import {
  projectSchema,
  overlaySchema,
  getValidationErrorsMap,
  type FieldChange,
  type OverlayCorners,
} from "@shared/validation/schemas";
import { computed } from "vue";
import { t } from "@/locales";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { formatDate } from "@/utils/dateFormat";
import { getCityNameCache } from "@/utils/cityNameCache";
import {
  prepareProjectValidationData,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { useOverlayPublisher } from "@/composables/overlay/useOverlayPublisher";
import {
  usePendingModificationsStore,
  type PendingOverlayModification,
} from "@/stores/pinia/pendingModificationsStore";
import type {
  SubmissionChange,
  SubmissionChangeType,
  SubmissionContext,
  SubmissionSummary,
} from "./submissionTypes";

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
      // Proposed caption/corners that aren't yet on the live store entry (tracked as deltas
      // in pendingModificationsStore). When absent, validate/buildSummary fall back to the
      // live store + Leaflet layer.
      proposed?: {
        caption?: string | null;
        corners?: OverlayCorners;
      };
      changedFields?: FieldChange[];
    };

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function normalizeFieldValue(
  field: keyof Project,
  value: unknown,
  projectSource: Partial<Project>,
): unknown {
  const fieldStr = String(field);
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
      Array.isArray(value) ? (value as string[]).toSorted((a, b) => a.localeCompare(b)) : [],
    );
  }
  return value ?? "";
}

function serializeForBackend(value: unknown): unknown {
  if (value === "" || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function hasShapes(v: unknown): boolean {
  return (
    v !== null &&
    v !== undefined &&
    typeof v === "object" &&
    (v as GeoJSON.GeometryCollection).geometries?.length > 0
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
  const validationData = prepareProjectValidationData(project, {
    lat: project.lat,
    lng: project.lng,
  });
  const result = projectSchema.safeParse(validationData);
  return result.success ? [] : zodErrorsToMessages(result.error);
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

export function useSubmissionService() {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();
  const { publishOverlay } = useOverlayPublisher();
  const { resetChangeRequestsLoaded, refreshPendingChangeRequests } = useChangeRequests();

  // City name cache built from the project store and all projects seen so far.
  const cityNamesCache = computed(() => {
    const cache: Record<string, string> = { ...getCityNameCache() };

    // Extract from all projects (includes both loaded and original cached projects)
    for (const project of Object.values(projectStore.projects)) {
      if (project.city && project.city.id === project.cityId && !cache[project.cityId]) {
        cache[project.cityId] = project.city.name;
      }
    }

    return cache;
  });

  function createProjectContext(
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
    const originalProject = projectStore.getOriginalProject(project.id);

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
      "cityId",
      "countryCode",
      "proposalDatePrecision",
      "startDatePrecision",
      "geometry",
      "tags",
    ];

    for (const field of fieldsToCheck) {
      const oldValue = (originalProject as unknown as Record<string, unknown>)[field];
      const newValue = project[field];

      const isGeometryField = field === "geometry";
      const isArrayField = field === "tags";

      const normalizedOld = normalizeFieldValue(
        field,
        oldValue,
        originalProject as Partial<Project>,
      );
      const normalizedNew = normalizeFieldValue(field, newValue, project);

      if (normalizedOld !== normalizedNew) {
        // Store raw objects for geometry/arrays so the backend receives proper JSON, not a string
        // Use serializeForBackend to convert empty strings to null for the API
        let pushedOldValue: unknown = serializeForBackend(normalizedOld);
        let pushedNewValue: unknown = serializeForBackend(normalizedNew);
        if (isGeometryField) {
          pushedOldValue = normalizedOld !== null ? oldValue : null;
          pushedNewValue = newValue ?? null;
        } else if (isArrayField) {
          pushedOldValue = oldValue;
          pushedNewValue = newValue;
        }
        changes.push({
          fieldName: String(field),
          oldValue: pushedOldValue,
          newValue: pushedNewValue,
          changeReason: customReason ?? undefined,
        });
      }
    }

    return changes;
  }

  function formatValueForDisplay(value: unknown, fieldName?: string): string {
    if (value === null || value === undefined || value === "") {
      return t("overlay.notSet");
    }

    // Special handling for geometry - show shape count
    if (fieldName === "geometry" && typeof value === "object") {
      const count = (value as GeoJSON.GeometryCollection).geometries.length;
      return t("shapes.geometrySummary", { count });
    }

    // Special handling for cityId - show city name
    if (fieldName === "cityId" && typeof value === "string") {
      // Check the cache (built from all projects and loaded cities)
      const cachedName = cityNamesCache.value[value];
      if (cachedName) {
        return cachedName;
      }
      return value; // Fallback to ID if city name not found
    }

    if (value instanceof Date) {
      return formatDate(value);
    }
    if (typeof value === "number") {
      return value.toFixed(6);
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  // Build human-readable summary for confirmation dialog
  function buildSummary(context: EntityUpdate): SubmissionSummary {
    const changes =
      context.entityType === "project"
        ? detectProjectChanges(context.entity)
        : (context.changedFields ?? []);
    const entityName =
      context.entityType === "project"
        ? context.entity.name
        : (context.proposed?.caption ??
          overlayStore.overlays[context.entityId]?.caption ??
          t("overlay.untitled"));

    let action = "";
    let requiresModeration = false;

    switch (context.changeType) {
      case "create":
        action = t("submission.createAction");
        requiresModeration = true;
        break;
      case "update_pending":
        action = t("submission.updatePendingAction");
        break;
      case "update_approved":
        action = t("submission.updateApprovedAction");
        requiresModeration = true;
        break;
    }

    const formattedChanges: SubmissionChange[] = changes.map((change) => ({
      field: change.fieldName as RemovableChange, // Safe cast - we control field names in detectChanges
      oldValue: formatValueForDisplay(change.oldValue, change.fieldName),
      newValue: formatValueForDisplay(change.newValue, change.fieldName),
      displayLabel: t(`fields.${change.fieldName}`),
    }));

    return {
      action,
      entityName,
      changes: formattedChanges,
      requiresModeration,
      entityType: context.entityType,
      changeType: context.changeType,
    };
  }

  function validateOverlay(context: Extract<EntityUpdate, { entityType: "overlay" }>): string[] {
    const liveOverlay = overlayStore.overlays[context.entityId];
    const corners =
      context.proposed?.corners ??
      getLayer(context.entityId)?.getCorners() ??
      liveOverlay?.corners ??
      [];

    const validationData = prepareOverlayValidationData({
      id: context.entityId,
      filename: liveOverlay?.filename ?? "",
      caption: context.proposed?.caption ?? liveOverlay?.caption ?? null,
      projectId: liveOverlay?.projectId ?? null,
      // oxlint-disable-next-line no-unsafe-type-assertion
      corners: corners.map((c: { lat: number; lng: number }) => ({ lat: c.lat, lng: c.lng })),
    });
    const result = overlaySchema.safeParse(validationData);
    return result.success ? [] : zodErrorsToMessages(result.error);
  }

  function validate(context: EntityUpdate): ValidationResult {
    const errors =
      context.entityType === "project" ? validateProject(context.entity) : validateOverlay(context);

    if (context.changeType !== "create") {
      const changes =
        context.entityType === "project"
          ? detectProjectChanges(context.entity)
          : (context.changedFields ?? []);
      if (changes.length === 0) {
        errors.push(t("errors.noChangesDetected"));
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async function submitProjectChangeRequest(
    project: Project,
    changes: FieldChange[],
  ): Promise<void> {
    await trpc.changes.submitChangeRequest.mutate({
      entityType: "project",
      entityId: project.id,
      changes,
    });

    projectStore.updateProject(project.id, { isModified: false });

    resetChangeRequestsLoaded();
    await refreshPendingChangeRequests();
  }

  // Local store + UI sync after a successful project publish: status flip, baseline cache,
  // marker add/recolor, and contributions-sidebar entry. Kept together so callers don't have
  // to remember the full cascade.
  function applyOptimisticPublishedProject(
    project: Project,
    changeType: SubmissionChangeType,
  ): void {
    projectStore.updateProject(project.id, { isModified: false, status: "pending" });
    projectStore.cacheProjectBackendState(project.id);

    const updated = projectStore.projects[project.id];
    if (!updated) return;

    if (changeType === "create") {
      addStandaloneProjectMarkerForProject(updated);
      projectStore.addProjectToUserContributions(updated);
      return;
    }

    updateStandaloneProjectMarkerColor(project.id, updated);
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
        isModified: false,
        hasPendingChanges: true,
      };
      if (cornersChange?.newValue) {
        // suggestedCorners powers the "view suggested position" preview; flipping
        // isViewingApprovedPosition turns the marker yellow while the CR is open.
        updates.suggestedCorners = cornersChange.newValue as OverlayCorners;
        updates.isViewingApprovedPosition = false;
      }
      overlayStore.updateOverlay(overlayId, updates);

      const liveOverlay = overlayStore.overlays[overlayId];
      if (liveOverlay) updateMarkerTooltip(liveOverlay);
      resetChangeRequestsLoaded();
      await refreshPendingChangeRequests();
      return;
    }

    // changeType === "update_pending"
    const hasCornersChange = changes.some((c) => c.fieldName === "corners");
    if (hasCornersChange) {
      // Pass the live store entry so publishOverlay's status/imageUrl mutations land in the store.
      const liveOverlay = overlayStore.overlays[overlayId];
      if (!liveOverlay) return;

      const project = liveOverlay.projectId
        ? projectStore.getProjectById(liveOverlay.projectId)
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
      projectStore.updateOverlayInUserContributions(overlayId, {
        caption: overlayData.caption,
      });
    }
  }

  async function submitEntity(context: EntityUpdate, customReason?: string): Promise<void> {
    const validation = validate(context);
    if (!validation.isValid) throw new Error(validation.errors.join(", "));

    const changes =
      context.entityType === "project"
        ? detectProjectChanges(context.entity, customReason)
        : (context.changedFields ?? []);

    if (context.entityType === "project") {
      await submitProject(context, changes);
    } else {
      await submitOverlay(context.entityId, context.changeType, changes);
    }
  }

  // Submit a single overlay modification (used for both allProjectModifications and pendingOverlayModifications).
  async function submitOverlayModification(
    overlayId: string,
    mod: Pick<PendingOverlayModification, "caption" | "corners">,
    reason: string,
  ): Promise<void> {
    const overlayObj = overlayStore.overlays[overlayId];
    if (!overlayObj) return;

    const isChangeRequest = overlayObj.status === "approved";

    const changedFields: FieldChange[] = [];
    const proposed: { caption?: string | null; corners?: OverlayCorners } = {};
    if (mod.caption) {
      changedFields.push({
        fieldName: "caption",
        oldValue: mod.caption.original,
        newValue: mod.caption.current,
      });
      proposed.caption = mod.caption.current;
    }
    if (mod.corners) {
      changedFields.push({
        fieldName: "corners",
        oldValue: mod.corners.original,
        newValue: mod.corners.current,
      });
      proposed.corners = mod.corners.current;
    }

    await submitEntity(
      {
        entityType: "overlay",
        entityId: overlayId,
        changeType: getChangeType(overlayObj),
        changedFields,
        proposed,
      },
      reason,
    );

    pendingModsStore.clearModification(overlayId);

    // For direct updates we collapse history so the submitted state is the new baseline;
    // change requests keep history so the proposal stays visible on edit-mode re-entry.
    const updates: Partial<OverlayObject> = { isModified: false };
    const submittedCorners = mod.corners?.current;
    if (submittedCorners?.length === 4 && !isChangeRequest) {
      updates.history = [submittedCorners];
      updates.redoStack = [];
      updates.corners = submittedCorners;
    }
    overlayStore.updateOverlay(overlayId, updates);
    const liveOverlay = overlayStore.overlays[overlayId];
    if (liveOverlay) {
      updateMarkerTooltip(liveOverlay);
    }
  }

  async function publishNewOverlays(overlayIds: string[], project: Project | null): Promise<void> {
    for (const overlayId of overlayIds) {
      const overlayObj = overlayStore.overlays[overlayId];
      if (!overlayObj) continue;
      await publishOverlay(overlayObj, project);
      // Collapse history so the just-published state is the new baseline.
      const publishedCorners = overlayObj.history.at(-1);
      if (publishedCorners?.length === 4) {
        overlayStore.updateOverlay(overlayId, {
          history: [publishedCorners],
          redoStack: [],
          corners: publishedCorners,
        });
      }
    }
  }

  async function submitContext(ctx: SubmissionContext, reason: string): Promise<void> {
    const project = ctx.projectId ? projectStore.getProjectById(ctx.projectId) : null;

    const newOverlayIds = ctx.newOverlayIds ?? [];

    // 1. Submit caption/corners updates for already-published overlays.
    const existingMods = (ctx.existingOverlayModifications ?? []).filter(
      (mod) => !newOverlayIds.includes(mod.overlayId),
    );
    for (const mod of existingMods) {
      await submitOverlayModification(mod.overlayId, mod, reason);
    }

    // 2. Publish brand-new overlays. Also publishes the project lazily if it's still local.
    await publishNewOverlays(newOverlayIds, project);

    // 3. Submit project metadata changes for already-published projects.
    const isExistingProject = project && project.status !== null;
    if (ctx.projectModified && ctx.projectId && isExistingProject && project) {
      const projectContext = createProjectContext(project);
      const projectChanges = detectProjectChanges(projectContext.entity);
      if (projectChanges.length > 0) {
        await submitEntity(projectContext, reason);
        projectStore.updateProject(project.id, { isModified: false });
      }
    }

    // 4. Brand-new project with no overlays: publish the project on its own.
    if (newOverlayIds.length === 0 && ctx.changeType === "create" && project?.status === null) {
      await submitEntity(createProjectContext(project, "create"), reason);
    }
  }

  return {
    createProjectContext,
    buildSummary,
    submitContext,
  };
}
