import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { trpc } from "@/client";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";
import { buildProjectPayload } from "@/services/project/projectMutations";
import { selectCity } from "@/services/navigation/locationNavigation";
import { updateStandaloneProjectMarkerColor } from "@/services/map/standaloneProjectMarkers";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import type { Project, OverlayObject, RemovableChange, ProjectForModeration } from "@/types/index";
import {
  projectSchema,
  overlaySchema,
  getValidationErrorsMap,
  type FieldChange,
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
export type SubmissionEntityType = "project" | "overlay";

// Submission context interface
export type SubmissionContext =
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

export interface SubmissionContextExtended {
  entityType: "project" | "overlay";
  entityId: string;
  changeType: SubmissionChangeType;
  entity: OverlayObject | Project | ProjectForModeration;
  projectId?: string;
  projectModified?: boolean;
  overlayModified?: boolean;
  allProjectModifications?: PendingOverlayModification[];
  pendingOverlayModifications?: string[];
  newOverlayIds?: string[];
}

export function isSubmissionContextExtended(ctx: unknown): ctx is SubmissionContextExtended {
  return (
    ctx !== null &&
    typeof ctx === "object" &&
    ("overlayModified" in ctx ||
      "pendingOverlayModifications" in ctx ||
      "allProjectModifications" in ctx)
  );
}

export interface SubmissionChange {
  field: RemovableChange;
  oldValue: any;
  newValue: any;
  displayLabel: string;
  // Optional overlay identification for deletion and thumbnail display
  overlayId?: string;
  thumbnailUrl?: string;
}

export interface SubmissionSummary {
  action: string;
  entityName: string;
  changes: SubmissionChange[];
  requiresModeration: boolean;
  entityType: SubmissionEntityType;
  changeType: SubmissionChangeType;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Field display names for user-friendly labels in UI
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  name: "Project Name",
  description: "Description",
  sourceUrl: "Source URL",
  proposalDate: "Proposal Date",
  startDate: "Start Date",
  endDate: "End Date",
  caption: "Overlay Caption",
  corners: "Position",
  cityId: "City",
  proposalDatePrecision: "Proposal Date Precision",
  startDatePrecision: "Start Date Precision",
  endDatePrecision: "End Date Precision",
  geometry: "Shapes",
};

// Check if a geometry value contains at least one shape
function hasShapes(v: unknown): boolean {
  return (
    v !== null &&
    v !== undefined &&
    typeof v === "object" &&
    ((v as GeoJSON.GeometryCollection).geometries?.length ?? 0) > 0
  );
}

// Normalize dates for comparison (handle Date objects vs yyyy-MM-dd strings)
function normalizeDate(val: any) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0]; // Get yyyy-MM-dd part
  if (typeof val === "string") return val.split("T")[0]; // Handle ISO strings or yyyy-MM-dd
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

// Determine submission change type based on entity status
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
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();
  const { publishOverlay } = useOverlayPublisher();
  const { resetChangeRequestsLoaded, refreshPendingChangeRequests } = useChangeRequests();

  // Build a combined city name cache from store cache + projects we've seen
  const cityNamesCache = computed(() => {
    const cache: Record<string, string> = { ...projectStore.cityNamesCache };

    // Extract from all projects (includes both loaded and original cached projects)
    for (const project of Object.values(projectStore.allProjects)) {
      if (project.city.id === project.cityId && !cache[project.cityId]) {
        cache[project.cityId] = project.city.name;
      }
    }

    return cache;
  });

  // Helper to create properly typed project submission context
  function createProjectContext(
    project: Project,
    changeType?: SubmissionChangeType,
  ): Extract<SubmissionContext, { entityType: "project" }> {
    return {
      entityType: "project",
      entityId: project.id,
      entity: project,
      changeType: changeType ?? getChangeType(project),
    };
  }

  // Helper to create properly typed overlay submission context
  function createOverlayContext(
    overlay: OverlayObject,
    changeType?: SubmissionChangeType,
  ): Extract<SubmissionContext, { entityType: "overlay" }> {
    return {
      entityType: "overlay",
      entityId: overlay.id,
      entity: overlay,
      changeType: changeType ?? getChangeType(overlay),
    };
  }

  // Calculate field differences between original and modified project
  function detectProjectChanges(project: Project, customReason?: string): FieldChange[] {
    const changes: FieldChange[] = [];
    const originalProject = projectStore.getOriginalProject(project.id);

    // No original version found in cache - might be a new/pending project
    if (!originalProject) return changes;

    const fieldsToCheck: (keyof Project)[] = [
      "name",
      "description",
      "sourceUrl",
      "proposalDate",
      "startDate",
      "endDate",
      "endDatePrecision",
      "cityId",
      "proposalDatePrecision",
      "startDatePrecision",
      "geometry",
    ];

    for (const field of fieldsToCheck) {
      // Cast to any as originalProject can be Project or UserContribution, both have these fields
      const oldValue = (originalProject as unknown as Record<string, unknown>)[field];
      const newValue = project[field];

      // Special handling for date fields
      const isDateField = ["proposalDate", "startDate", "endDate"].includes(String(field));
      const isGeometryField = String(field) === "geometry";
      const isDatePrecisionField = getPrecisionDateField(field) !== null;

      // Geometry uses JSON stringification for comparison; dates use normalization; others use raw value
      let normalizedOld: unknown = null;
      let normalizedNew: unknown = null;
      let effectiveOldValue: unknown = oldValue;
      if (isDateField) {
        normalizedOld = normalizeDate(oldValue);
        normalizedNew = normalizeDate(newValue);
      } else if (isGeometryField) {
        // If original project lacks geometry (e.g. cached from UserContribution type which
        // doesn't include the geometry column), fall back to the backend geometry from loaded
        // overlay data — so we show "N shapes → M shapes" instead of "Not set → M shapes".
        if (!hasShapes(effectiveOldValue)) {
          const backendOverlay = mapStore.currentCityOverlays.find(
            (o) => o.project?.id === project.id && hasShapes(o.project?.geometry),
          );
          if (backendOverlay?.project?.geometry) {
            effectiveOldValue = backendOverlay.project.geometry;
          }
        }
        normalizedOld = hasShapes(effectiveOldValue) ? JSON.stringify(effectiveOldValue) : null;
        normalizedNew = hasShapes(newValue) ? JSON.stringify(newValue) : null;
      } else if (isDatePrecisionField) {
        normalizedOld = normalizeDatePrecision(
          field,
          oldValue,
          originalProject as Partial<Project>,
        );
        normalizedNew = normalizeDatePrecision(field, newValue, project);
      } else {
        normalizedOld = oldValue ?? "";
        normalizedNew = newValue ?? "";
      }

      if (normalizedOld !== normalizedNew) {
        let storedOldValue: unknown = normalizedOld;
        if (isGeometryField) {
          storedOldValue = normalizedOld !== null ? effectiveOldValue : null;
        }
        changes.push({
          fieldName: String(field),
          // Store raw objects for geometry so the backend receives proper JSON, not a string
          // Use effectiveOldValue (falls back to backend geometry if original cache lacked it)
          oldValue: storedOldValue,
          newValue: isGeometryField ? (newValue ?? null) : normalizedNew,
          changeReason: customReason ?? undefined,
        });
      }
    }

    return changes;
  }

  // Format value for human-readable display
  function formatValueForDisplay(value: any, fieldName?: string): string {
    if (value === null || value === undefined || value === "") {
      return "Not set";
    }

    // Special handling for geometry - show shape count
    if (fieldName === "geometry" && typeof value === "object") {
      const count = (value as GeoJSON.GeometryCollection).geometries?.length ?? 0;
      return `${count} shape${count !== 1 ? "s" : ""}`;
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
  function buildSummary(context: SubmissionContext): SubmissionSummary {
    const changes =
      context.entityType === "project"
        ? detectProjectChanges(context.entity)
        : (context.changedFields ?? []);
    const entityName =
      context.entityType === "project"
        ? context.entity.name
        : (context.entity.caption ?? "Unnamed Overlay");

    let action = "";
    let requiresModeration = false;

    switch (context.changeType) {
      case "create":
        action = `Create new ${context.entityType}`;
        requiresModeration = true;
        break;
      case "update_pending":
        action = `Update pending ${context.entityType}`;
        break;
      case "update_approved":
        action = `Suggest changes to approved ${context.entityType}`;
        requiresModeration = true;
        break;
    }

    const formattedChanges: SubmissionChange[] = changes.map((change) => ({
      field: change.fieldName as RemovableChange, // Safe cast - we control field names in detectChanges
      oldValue: formatValueForDisplay(change.oldValue, change.fieldName),
      newValue: formatValueForDisplay(change.newValue, change.fieldName),
      displayLabel: FIELD_DISPLAY_NAMES[change.fieldName] ?? change.fieldName,
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

  // Validate submission before proceeding using Zod schemas
  function validate(context: SubmissionContext): ValidationResult {
    const errors: string[] = [];

    // Project-specific validation with Zod
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

    // Overlay-specific validation with Zod
    if (context.entityType === "overlay") {
      const corners = getLayer(context.entity.id)?.getCorners() ?? context.entity.corners;

      const validationData = prepareOverlayValidationData({
        id: context.entity.id,
        filename: context.entity.filename,
        caption: context.entity.caption,
        projectId: context.entity.projectId,
        corners: corners.map((c: any) => ({ lat: c.lat, lng: c.lng })),
      });

      const result = overlaySchema.safeParse(validationData);

      if (!result.success) {
        const zodErrors = getValidationErrorsMap(result.error);
        for (const error of Object.values(zodErrors)) {
          errors.push(t(error.key, error.params ?? {}));
        }
      }
    }

    // Check if there are any changes to submit (for updates)
    if (context.changeType !== "create") {
      const changes =
        context.entityType === "project"
          ? detectProjectChanges(context.entity)
          : (context.changedFields ?? []);
      if (changes.length === 0) {
        errors.push("No changes detected to submit");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Submit change request for approved project
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

    if (project.cityId) {
      mapStore.clearCityCaches(project.cityId);
    }

    resetChangeRequestsLoaded();
    await refreshPendingChangeRequests(true);
  }

  // Publish pending or new project directly to backend
  async function publishProjectDirect(
    project: Project,
    changeType: SubmissionChangeType,
  ): Promise<void> {
    await trpc.project.publishProject.mutate(buildProjectPayload(project));

    projectStore.updateProject(project.id, { isModified: false, status: "pending" });

    projectStore.cacheProjectBackendState(project.id);

    const updatedProject = projectStore.projects[project.id];
    if (updatedProject) {
      updateStandaloneProjectMarkerColor(project.id, updatedProject);
    }

    if (project.cityId) {
      mapStore.clearCityCaches(project.cityId);
    }

    if (mapStore.selectedCity) {
      selectCity(
        mapStore.selectedCity.id,
        mapStore.selectedCity.name,
        mapStore.selectedCity.nameLocal,
        mapStore.selectedCity.countryCode,
      );
    } else {
      selectCity(null, "", null);
    }

    if (changeType === "create") {
      // Optimistically add project to contributions (status is already "pending" from line 513)
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

  // Route project submission to appropriate handler
  async function submitProject(
    context: Extract<SubmissionContext, { entityType: "project" }>,
    changes: FieldChange[],
  ): Promise<void> {
    if (context.changeType === "update_approved") {
      await submitProjectChangeRequest(context.entity, changes);
    } else {
      // For pending/new projects: all changes (including geometry) go directly through publishProject
      await publishProjectDirect(context.entity, context.changeType);
    }
  }

  // Submit overlay changes to backend
  async function submitOverlay(
    context: Extract<SubmissionContext, { entityType: "overlay" }>,
    changes: FieldChange[],
  ): Promise<void> {
    if (context.changeType === "create") {
      // Create new overlay requires full image upload handling
      throw new Error("New overlay creation should use publishOverlay directly");
    }

    if (context.changeType === "update_approved") {
      if (changes.length === 0) throw new Error("No changes detected for approved overlay");
      // Submit change requests for approved overlays
      await trpc.changes.submitChangeRequest.mutate({
        entityType: "overlay",
        entityId: context.entity.id,
        changes,
      });

      // Reset modified flag and set pending changes flag after successfully submitting change request
      context.entity.isModified = false;
      context.entity.hasPendingChanges = true;

      // Save suggested corners from the change request so "view suggested position" button works immediately
      const cornersChange = changes.find((c) => c.fieldName === "corners");
      if (cornersChange?.newValue) {
        context.entity.suggestedCorners = cornersChange.newValue as { lat: number; lng: number }[];
        // User is currently viewing the suggested position (the position they just modified)
        // Set to false so marker shows yellow to indicate pending changes
        context.entity.isViewingApprovedPosition = false;
      }

      // CRITICAL: Also update the overlay in overlayStore so preview buttons work
      const overlayInStore = overlayStore.overlays[context.entity.id];
      if (overlayInStore && cornersChange?.newValue) {
        overlayInStore.suggestedCorners = cornersChange.newValue as { lat: number; lng: number }[];
        overlayInStore.hasPendingChanges = true;
        overlayInStore.isViewingApprovedPosition = false;
      }

      updateMarkerTooltip(context.entity);
      resetChangeRequestsLoaded();
      await refreshPendingChangeRequests(true);
    }

    if (context.changeType === "update_pending") {
      // Direct update for pending overlays
      const hasCornersChange = changes.some((c) => c.fieldName === "corners");

      if (hasCornersChange) {
        // Try multiple store locations for project lookup
        // 1. projects: Active map cache (visible on screen)
        // 2. allProjects: Includes nearby projects not in main city cache
        // 3. userContributions: Projects pending/saved but interacted with via sidebar
        let project = null;
        if (context.entity.projectId) {
          project =
            projectStore.projects[context.entity.projectId] ??
            projectStore.allProjects[context.entity.projectId] ??
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

        // Optimistically update pending overlay in user contributions
        if (overlayData.caption !== undefined) {
          projectStore.updateOverlayInUserContributions(context.entity.id, {
            name: overlayData.caption || "Unnamed",
          });
        }
      }
    }

    // Invalidate city caches uniformly for both paths
    const cityId = context.entity.project?.cityId;
    if (cityId) {
      mapStore.clearCityCaches(cityId);
    }
  }

  // Unified submission handler - internal routing based on validated context
  async function submitEntity(context: SubmissionContext, customReason?: string): Promise<void> {
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

  // Helper to submit a single overlay modification (shared by both allProjectModifications and pendingOverlayModifications paths)
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

  async function submitExtendedContext(
    extCtx: SubmissionContextExtended,
    reason: string,
  ): Promise<void> {
    // Find the associated project to ensure we can publish overlays and use it for references
    let project: Project | null = null;
    if (extCtx.projectId) {
      project =
        projectStore.projects[extCtx.projectId] ??
        projectStore.allProjects[extCtx.projectId] ??
        (projectStore.userContributions.find(
          (p) => p.id === extCtx.projectId,
        ) as unknown as Project) ??
        null;
    }

    // 1. Submit existing overlay modifications first
    if (extCtx.allProjectModifications && extCtx.allProjectModifications.length > 0) {
      // Get mods only for *existing* overlays
      const existMods = extCtx.allProjectModifications.filter(
        (mod) => !extCtx.newOverlayIds?.includes(mod.overlayId),
      );

      for (const mod of existMods) {
        await submitOverlayModification(mod.overlayId, mod, reason);
      }
    } else if (
      extCtx.pendingOverlayModifications &&
      extCtx.pendingOverlayModifications.length > 0
    ) {
      for (const overlayId of extCtx.pendingOverlayModifications) {
        const mod = pendingModsStore.getPendingModifications(overlayId);
        if (!mod) continue;
        await submitOverlayModification(overlayId, mod, reason);
      }
    }

    // 2. Publish new overlays
    if (extCtx.newOverlayIds && extCtx.newOverlayIds.length > 0) {
      for (const overlayId of extCtx.newOverlayIds) {
        const overlayObj = overlayStore.overlays[overlayId];
        if (overlayObj) {
          await publishOverlay(overlayObj, project);
        }
      }
    }

    // 3. Submit project metadata changes for existing projects
    const isExistingProject = project && project.status !== null;
    if (extCtx.projectModified && extCtx.projectId && isExistingProject && project) {
      const projectContext = createProjectContext(project);
      const projectChanges = detectProjectChanges(projectContext.entity);
      if (projectChanges.length > 0) {
        await submitEntity(projectContext, reason);
        projectStore.updateProject(project.id, { isModified: false });
      }
    }

    // 4. Otherwise, if new project and there were no overlays, just publish the empty project
    const hasNewOverlays = extCtx.newOverlayIds && extCtx.newOverlayIds.length > 0;
    if (
      !hasNewOverlays &&
      extCtx.entityType === "project" &&
      extCtx.changeType === "create" &&
      project?.status === null
    ) {
      await submitEntity(createProjectContext(project, "create"), reason);
    }
  }

  // Submit single entity context directly
  async function submitStandardContext(context: SubmissionContext, reason: string): Promise<void> {
    await submitEntity(context, reason);
    if (context.entityType === "project") {
      projectStore.updateProject(context.entityId, { isModified: false });
    }
  }

  return {
    createProjectContext,
    buildSummary,
    validate,
    submitExtendedContext,
    submitStandardContext,
  };
}
