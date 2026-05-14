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
import {
  prepareProjectValidationData,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";
import { useOverlayPublisher } from "@/composables/overlay/useOverlayPublisher";
import {
  usePendingModificationsStore,
  type PendingOverlayModification,
} from "@/stores/pinia/pendingModificationsStore";

// Unified submission types for consolidated workflow
export type SubmissionChangeType = "create" | "update_pending" | "update_approved";
type SubmissionEntityType = "project" | "overlay";

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
      entity: OverlayObject;
      changedFields?: FieldChange[];
    };

// Public submission context: a batch of work to do for a single project.
export interface SubmissionContext {
  changeType: SubmissionChangeType;
  projectId?: string;
  projectModified?: boolean;
  // Caption/corners changes captured locally on already-published overlays.
  existingOverlayModifications?: PendingOverlayModification[];
  // Brand-new overlays (status null) to publish.
  newOverlayIds?: string[];
}

export interface SubmissionChange {
  field: RemovableChange;
  oldValue: unknown;
  newValue: unknown;
  displayLabel: string;
  // Optional overlay identification for deletion and thumbnail display
  overlayId?: string;
  thumbnailUrl?: string;
}

export interface SubmissionSummary {
  action: string;
  entityName: string | null;
  changes: SubmissionChange[];
  requiresModeration: boolean;
  entityType: SubmissionEntityType;
  changeType: SubmissionChangeType;
}

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

function getChangeType(entity: Project | OverlayObject): SubmissionChangeType {
  if (!entity.id || entity.id.startsWith("temp-")) {
    return "create";
  }

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
    const cache: Record<string, string> = { ...projectStore.cityNamesCache };

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

  function createOverlayContext(
    overlay: OverlayObject,
    changeType?: SubmissionChangeType,
  ): Extract<EntityUpdate, { entityType: "overlay" }> {
    return {
      entityType: "overlay",
      entityId: overlay.id,
      entity: overlay,
      changeType: changeType ?? getChangeType(overlay),
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
      // Cast: originalProject can be Project or UserContribution; both share these keys.
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
        : (context.entity.caption ?? t("overlay.untitled"));

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

  function validate(context: EntityUpdate): ValidationResult {
    const errors: string[] = [];

    if (context.entityType === "project") {
      const validationData = prepareProjectValidationData(context.entity, {
        lat: context.entity.lat,
        lng: context.entity.lng,
      });

      const result = projectSchema.safeParse(validationData);

      if (!result.success) {
        const zodErrors = getValidationErrorsMap(result.error);
        for (const error of Object.values(zodErrors)) {
          errors.push(t(error.key, error.params ?? {}));
        }
      }
    }

    if (context.entityType === "overlay") {
      const corners = getLayer(context.entity.id)?.getCorners() ?? context.entity.corners;

      const validationData = prepareOverlayValidationData({
        id: context.entity.id,
        filename: context.entity.filename,
        caption: context.entity.caption,
        projectId: context.entity.projectId,
        // oxlint-disable-next-line no-unsafe-type-assertion
        corners: corners.map((c: { lat: number; lng: number }) => ({ lat: c.lat, lng: c.lng })),
      });

      const result = overlaySchema.safeParse(validationData);

      if (!result.success) {
        const zodErrors = getValidationErrorsMap(result.error);
        for (const error of Object.values(zodErrors)) {
          errors.push(t(error.key, error.params ?? {}));
        }
      }
    }

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
    await refreshPendingChangeRequests(true);
  }

  async function publishProjectDirect(
    project: Project,
    changeType: SubmissionChangeType,
  ): Promise<void> {
    await trpc.project.publishProject.mutate(projectSchema.parse(project));

    projectStore.updateProject(project.id, { isModified: false, status: "pending" });

    projectStore.cacheProjectBackendState(project.id);

    const updatedProject = projectStore.projects[project.id];
    if (updatedProject) {
      if (changeType === "create") {
        addStandaloneProjectMarkerForProject(updatedProject);
      } else {
        updateStandaloneProjectMarkerColor(project.id, updatedProject);
      }
    }

    if (changeType === "create") {
      // Optimistically add project to contributions (status is already "pending" from publishProject above)
      if (updatedProject) {
        projectStore.addProjectToUserContributions(updatedProject);
      }
    } else if (changeType === "update_pending") {
      // Optimistically update pending project in user contributions cache
      projectStore.updateProjectInUserContributions(project.id, {
        name: project.name,
        description: project.description,
        sourceUrl: project.sourceUrl,
        updatedAt: new Date(),
      });
    }
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
    context: Extract<EntityUpdate, { entityType: "overlay" }>,
    changes: FieldChange[],
  ): Promise<void> {
    if (context.changeType === "create") {
      throw new Error("New overlay creation should use publishOverlay directly");
    }

    if (context.changeType === "update_approved") {
      if (changes.length === 0) throw new Error(t("errors.noChangesDetected"));
      // Submit change requests for approved overlays
      await trpc.changes.submitChangeRequest.mutate({
        entityType: "overlay",
        entityId: context.entity.id,
        changes,
      });

      // Reset modified flag and set pending changes flag after submitting change request.
      context.entity.isModified = false;
      context.entity.hasPendingChanges = true;

      // Save suggested corners so the "view suggested position" button works immediately.
      const cornersChange = changes.find((c) => c.fieldName === "corners");
      if (cornersChange?.newValue) {
        context.entity.suggestedCorners = cornersChange.newValue as OverlayCorners;
        // Marker shows yellow to indicate pending changes.
        context.entity.isViewingApprovedPosition = false;
      }

      // CRITICAL: Also sync the overlay in overlayStore so preview buttons work immediately.
      const overlayInStore = overlayStore.overlays[context.entity.id];
      if (overlayInStore && cornersChange?.newValue) {
        overlayInStore.suggestedCorners = cornersChange.newValue as OverlayCorners;
        overlayInStore.hasPendingChanges = true;
        overlayInStore.isViewingApprovedPosition = false;
      }

      updateMarkerTooltip(context.entity);
      resetChangeRequestsLoaded();
      await refreshPendingChangeRequests(true);
    }

    if (context.changeType === "update_pending") {
      const hasCornersChange = changes.some((c) => c.fieldName === "corners");

      if (hasCornersChange) {
        // Project lookup: check both the active map cache and the user contributions sidebar.
        let project = null;
        if (context.entity.projectId) {
          project =
            projectStore.projects[context.entity.projectId] ??
            (projectStore.userContributions.find(
              (p) => p.id === context.entity.projectId,
            ) as unknown as Project) ??
            null;
        }
        await publishOverlay(context.entity, project);
      } else {
        const overlayData: { id: string; caption?: string } = { id: context.entity.id };
        const captionChange = changes.find((c) => c.fieldName === "caption");
        if (captionChange) {
          overlayData.caption = String(captionChange.newValue ?? "");
        }

        await trpc.overlay.updateOverlay.mutate(overlayData);

        if (overlayData.caption !== undefined) {
          projectStore.updateOverlayInUserContributions(context.entity.id, {
            caption: overlayData.caption,
          });
        }
      }
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
      await submitOverlay(context, changes);
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

    const overlayWithChanges = {
      ...overlayObj,
      caption: mod.caption?.current ?? overlayObj.caption,
      corners: mod.corners?.current ?? overlayObj.corners,
    };

    const changedFields: FieldChange[] = [];
    if (mod.caption)
      changedFields.push({
        fieldName: "caption",
        oldValue: mod.caption.original,
        newValue: mod.caption.current,
      });
    if (mod.corners)
      changedFields.push({
        fieldName: "corners",
        oldValue: mod.corners.original,
        newValue: mod.corners.current,
      });

    const overlayContext = createOverlayContext(overlayWithChanges);
    overlayContext.changedFields = changedFields;
    await submitEntity(overlayContext, reason);

    pendingModsStore.clearModification(overlayId);
  }

  async function submitContext(ctx: SubmissionContext, reason: string): Promise<void> {
    let project: Project | null = null;
    if (ctx.projectId) {
      project =
        projectStore.projects[ctx.projectId] ??
        (projectStore.userContributions.find(
          (p) => p.id === ctx.projectId,
        ) as unknown as Project) ??
        null;
    }

    const newOverlayIds = ctx.newOverlayIds ?? [];

    // 1. Submit caption/corners updates for already-published overlays.
    const existingMods = (ctx.existingOverlayModifications ?? []).filter(
      (mod) => !newOverlayIds.includes(mod.overlayId),
    );
    for (const mod of existingMods) {
      await submitOverlayModification(mod.overlayId, mod, reason);
    }

    // 2. Publish brand-new overlays. Also publishes the project lazily if it's still local.
    for (const overlayId of newOverlayIds) {
      const overlayObj = overlayStore.overlays[overlayId];
      if (overlayObj) {
        await publishOverlay(overlayObj, project);
      }
    }

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
    validate,
    submitContext,
  };
}
