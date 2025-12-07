import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { trpc } from "@/client";
import { buildProjectPayload } from "@/composables/project/useProjectMutations";
import {
  loadCityProjects,
  updateStandaloneProjectMarkerColor,
} from "@/composables/map/useCityMarkers";
import { updateMarkerTooltip } from "@/composables/overlay/useOverlayMarkers";
import type { Project, OverlayObject } from "@/types/index";
import type { FieldChange } from "@shared/types";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { t } from "@/locales";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { formatDate } from "@/utils/dateFormat";
import { projectSchema, overlaySchema, getValidationErrorsMap } from "@shared/validation/schemas";
import {
  prepareProjectValidationData,
  prepareOverlayValidationData,
} from "@/utils/validationHelpers";

// AI : Unified submission types for consolidated workflow
export type SubmissionChangeType = "create" | "update_pending" | "update_approved";
export type SubmissionEntityType = "project" | "overlay";

// AI : Base submission context interface
interface BaseSubmissionContext {
  entityId: string;
  changeType: SubmissionChangeType;
  changedFields?: FieldChange[];
}

// AI : Discriminated union for type-safe entity handling
export type SubmissionContext =
  | (BaseSubmissionContext & {
      entityType: "project";
      entity: Project;
    })
  | (BaseSubmissionContext & {
      entityType: "overlay";
      entity: OverlayObject;
    });

export interface SubmissionChange {
  field: string;
  oldValue: any;
  newValue: any;
  displayLabel: string;
}

export interface SubmissionSummary {
  action: string;
  entityName: string;
  changes: SubmissionChange[];
  requiresModeration: boolean;
  entityType: SubmissionEntityType;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// AI : Field display names for user-friendly labels in UI
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  name: "Project Name",
  description: "Description",
  sourceUrl: "Source URL",
  proposalDate: "Proposal Date",
  startDate: "Start Date",
  endDate: "End Date",
  latestUpdateOn: "Latest Update",
  caption: "Overlay Caption",
  projectId: "Parent Project",
  corners: "Position",
  cityId: "City",
};

// AI : Normalize dates for comparison (handle Date objects vs yyyy-MM-dd strings)
function normalizeDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0]; // AI : Get yyyy-MM-dd part
  if (typeof val === "string") return val.split("T")[0]; // AI : Handle ISO strings or yyyy-MM-dd
  return null;
}

// AI : Determine submission change type based on entity status
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
  const { currentCityOverlays } = storeToRefs(mapStore);
  const { resetChangeRequestsLoaded, refreshPendingChangeRequests } = useChangeRequests();

  // AI : Build a combined city name cache from store cache + projects we've seen
  const cityNamesCache = computed(() => {
    const cache: Record<string, string> = { ...projectStore.cityNamesCache };

    // AI : Extract city names from original backend projects (if not already in cache)
    Object.values(projectStore.originalBackendProjects).forEach((project) => {
      if (project.city && project.cityId && !cache[project.cityId]) {
        cache[project.cityId] = project.city.name;
      }
    });

    // AI : Extract from all projects (in case we have more cities)
    Object.values(projectStore.allProjects).forEach((project) => {
      if (
        project.city &&
        project.cityId &&
        project.city.id === project.cityId &&
        !cache[project.cityId]
      ) {
        cache[project.cityId] = project.city.name;
      }
    });

    return cache;
  });

  // AI : Helper to create properly typed project submission context
  function createProjectContext(
    project: Project,
    changeType?: SubmissionChangeType,
  ): SubmissionContext {
    const ctx: BaseSubmissionContext & { entityType: "project"; entity: Project } = {
      entityType: "project",
      entityId: project.id,
      entity: project,
      changeType: changeType ?? getChangeType(project),
    };
    return ctx;
  }

  // AI : Helper to create properly typed overlay submission context
  function createOverlayContext(
    overlay: OverlayObject,
    changeType?: SubmissionChangeType,
  ): SubmissionContext {
    const ctx: BaseSubmissionContext & { entityType: "overlay"; entity: OverlayObject } = {
      entityType: "overlay",
      entityId: overlay.id,
      entity: overlay,
      changeType: changeType ?? getChangeType(overlay),
    };
    return ctx;
  }

  // AI : Detect all changes for a project entity by fetching original from backend cache
  function detectProjectChanges(project: Project, customReason?: string): FieldChange[] {
    const changes: FieldChange[] = [];

    // AI : Try to find original project from the originalBackendProjects cache
    // This cache stores snapshots of approved projects before local modifications
    const originalProject = projectStore.originalBackendProjects[project.id];

    if (!originalProject) {
      // AI : No original version found in cache - might be a new/pending project
      return changes;
    }

    const fieldsToCheck: (keyof Project)[] = [
      "name",
      "description",
      "sourceUrl",
      "proposalDate",
      "startDate",
      "endDate",
      "latestUpdateOn",
      "cityId",
    ];

    fieldsToCheck.forEach((field) => {
      const oldValue = originalProject[field];
      const newValue = project[field];

      // AI : Special handling for date fields
      const isDateField = ["proposalDate", "startDate", "endDate", "latestUpdateOn"].includes(
        String(field),
      );

      if (isDateField) {
        const normalizedOld = normalizeDate(oldValue);
        const normalizedNew = normalizeDate(newValue);

        if (normalizedOld !== normalizedNew) {
          changes.push({
            fieldName: String(field),
            oldValue: normalizedOld,
            newValue: normalizedNew,
            changeReason: customReason ?? undefined,
          });
        }
      } else if (oldValue !== newValue) {
        // AI : For non-date fields, direct comparison
        changes.push({
          fieldName: String(field),
          oldValue: oldValue ?? null,
          newValue: newValue ?? null,
          changeReason: customReason ?? undefined,
        });
      }
    });

    return changes;
  }

  // AI : Detect all changes for an overlay entity
  function detectOverlayChanges(overlay: OverlayObject, customReason?: string): FieldChange[] {
    const changes: FieldChange[] = [];

    // AI : Find original overlay data from backend (approved version)
    const originalOverlay = currentCityOverlays.value.find((o) => o.id === overlay.id);
    if (!originalOverlay) {
      // AI : If no original found, this is a new overlay or we can't detect changes
      return changes;
    }

    // AI : Check projectId change
    if (overlay.projectId !== originalOverlay.projectId) {
      changes.push({
        fieldName: "projectId",
        oldValue: originalOverlay.projectId,
        newValue: overlay.projectId,
        changeReason: customReason ?? undefined,
      });
    }

    // AI : Check caption change
    if (overlay.caption !== originalOverlay.caption) {
      changes.push({
        fieldName: "caption",
        oldValue: originalOverlay.caption ?? null,
        newValue: overlay.caption,
        changeReason: customReason ?? undefined,
      });
    }

    // AI : Check corner positions (use current Leaflet corners if available)
    const currentCorners = overlay.overlay
      ? overlay.overlay.getCorners().map((c) => ({ lat: c.lat, lng: c.lng }))
      : overlay.corners;

    const normalizedCurrentCorners = currentCorners.map((c) => ({ lat: c.lat, lng: c.lng }));
    const normalizedOriginalCorners = originalOverlay.corners.map((c) => ({
      lat: c.lat,
      lng: c.lng,
    }));

    if (JSON.stringify(normalizedCurrentCorners) !== JSON.stringify(normalizedOriginalCorners)) {
      changes.push({
        fieldName: "corners",
        oldValue: normalizedOriginalCorners,
        newValue: normalizedCurrentCorners,
        changeReason: customReason ?? undefined,
      });
    }

    return changes;
  }

  // AI : Unified change detection for any entity
  function detectChanges(context: SubmissionContext, customReason?: string): FieldChange[] {
    if (context.changedFields) {
      return context.changedFields;
    }

    if (context.entityType === "project") {
      return detectProjectChanges(context.entity, customReason);
    } else {
      return detectOverlayChanges(context.entity, customReason);
    }
  }

  // AI : Format value for human-readable display
  function formatValueForDisplay(value: any, fieldName?: string): string {
    if (value === null || value === undefined || value === "") {
      return "Not set";
    }

    // AI : Special handling for cityId - show city name
    if (fieldName === "cityId" && typeof value === "string") {
      // AI : Check the cache (built from all projects and loaded cities)
      const cachedName = cityNamesCache.value[value];
      if (cachedName) {
        return cachedName;
      }
      return value; // AI : Fallback to ID if city name not found
    }

    // AI : Special handling for projectId - show project name
    if (fieldName === "projectId" && typeof value === "string") {
      const project = projectStore.allProjects[value];
      if (project?.name) {
        return project.name;
      }
      return value; // AI : Fallback to ID if project not found
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

  // AI : Build human-readable summary for confirmation dialog
  function buildSummary(context: SubmissionContext): SubmissionSummary {
    const changes = detectChanges(context);
    const entityName =
      context.entityType === "project"
        ? context.entity.name
        : (context.entity.caption ?? "Unnamed Overlay");

    let action: string;
    let requiresModeration: boolean;

    switch (context.changeType) {
      case "create":
        action = `Create new ${context.entityType}`;
        requiresModeration = true;
        break;
      case "update_pending":
        action = `Update pending ${context.entityType}`;
        requiresModeration = false;
        break;
      case "update_approved":
        action = `Suggest changes to approved ${context.entityType}`;
        requiresModeration = true;
        break;
    }

    const formattedChanges: SubmissionChange[] = changes.map((change) => ({
      field: change.fieldName,
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
    };
  }

  // AI : Validate submission before proceeding using Zod schemas
  function validate(context: SubmissionContext): ValidationResult {
    const errors: string[] = [];

    // AI : Project-specific validation with Zod
    if (context.entityType === "project") {
      const validationData = prepareProjectValidationData(context.entity, {
        lat: context.entity.lat,
        lng: context.entity.lng,
      });

      const result = projectSchema.safeParse(validationData);

      if (!result.success) {
        const zodErrors = getValidationErrorsMap(result.error);
        Object.values(zodErrors).forEach((error) => {
          errors.push(t(error.key, error.params ?? {}));
        });
      }
    }

    // AI : Overlay-specific validation with Zod
    if (context.entityType === "overlay") {
      const corners = context.entity.overlay?.getCorners() ?? context.entity.corners;

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
        Object.values(zodErrors).forEach((error) => {
          errors.push(t(error.key, error.params ?? {}));
        });
      }
    }

    // AI : Check if there are any changes to submit (for updates)
    if (context.changeType !== "create") {
      const changes = detectChanges(context);
      if (changes.length === 0) {
        errors.push("No changes detected to submit");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // AI : Submit change request for approved project
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
      mapStore.clearCityProjectsCache(project.cityId);
      mapStore.clearCityStandaloneProjectsCache(project.cityId);
    }

    resetChangeRequestsLoaded();
    await refreshPendingChangeRequests(true);
  }

  // AI : Publish pending or new project directly to backend
  async function publishProjectDirect(
    project: Project,
    changeType: SubmissionChangeType,
  ): Promise<void> {
    const publishResult = await trpc.project.publishProject.mutate(buildProjectPayload(project));

    if (!publishResult.success) {
      throw new Error("Backend publish failed");
    }

    projectStore.updateProject(project.id, { isModified: false, status: "pending" });
    projectStore.cacheProjectBackendState(project.id);

    const updatedProject = projectStore.projects[project.id];
    if (updatedProject) {
      updateStandaloneProjectMarkerColor(project.id, updatedProject);
    }

    if (project.cityId) {
      mapStore.clearCityProjectsCache(project.cityId);
      mapStore.clearCityStandaloneProjectsCache(project.cityId);
    }

    if (mapStore.selectedCity) {
      await loadCityProjects(
        mapStore.selectedCity.id,
        mapStore.selectedCity.name,
        true,
        mapStore.selectedCity.countryCode,
      );
    } else {
      await loadCityProjects(null, "", true);
    }

    if (changeType === "create") {
      const updatedProjectForContributions = projectStore.projects[project.id];
      if (updatedProjectForContributions) {
        projectStore.addProjectToUserContributions(updatedProjectForContributions);
      }
    } else if (changeType === "update_pending") {
      projectStore.updateProjectInUserContributions(project.id, {
        name: project.name,
        description: project.description,
        sourceUrl: project.sourceUrl,
        updatedAt: new Date(),
      });
    }
  }

  // AI : Route project submission to appropriate handler
  async function submitProject(
    context: Extract<SubmissionContext, { entityType: "project" }>,
    changes: FieldChange[],
  ): Promise<void> {
    if (context.changeType === "update_approved") {
      await submitProjectChangeRequest(context.entity, changes);
    } else {
      await publishProjectDirect(context.entity, context.changeType);
    }
  }

  // AI : Submit overlay changes to backend
  async function submitOverlay(
    context: Extract<SubmissionContext, { entityType: "overlay" }>,
    changes: FieldChange[],
  ): Promise<void> {
    if (context.changeType === "update_approved") {
      // AI : Submit change requests for approved overlays
      if (changes.length === 0) {
        throw new Error("No changes detected for approved overlay");
      }

      await trpc.changes.submitChangeRequest.mutate({
        entityType: "overlay",
        entityId: context.entity.id,
        changes,
      });

      // AI : Reset modified flag and set pending changes flag after successfully submitting change request
      context.entity.isModified = false;
      context.entity.hasPendingChanges = true;

      // AI : Save suggested corners from the change request so "view suggested position" button works immediately
      const cornersChange = changes.find((c) => c.fieldName === "corners");
      if (cornersChange?.newValue) {
        context.entity.suggestedCorners = cornersChange.newValue as { lat: number; lng: number }[];
        // AI : User is currently viewing the suggested position (the position they just modified)
        // AI : Set to false so marker shows yellow to indicate pending changes
        context.entity.isViewingApprovedPosition = false;
      }

      updateMarkerTooltip(context.entity);

      // AI : Invalidate all mode caches for this city (change affects all modes)
      const cityId = context.entity.project?.cityId;
      if (cityId) {
        mapStore.clearCityProjectsCache(cityId);
        mapStore.clearCityStandaloneProjectsCache(cityId);
      }

      // AI : Refresh pending change requests to show in side menu (user's own only)
      resetChangeRequestsLoaded();
      await refreshPendingChangeRequests(true); // forceUserOnly = true for My Contributions
    } else if (context.changeType === "update_pending") {
      // AI : Direct update for pending overlays
      const overlayData: { id: string; caption?: string } = { id: context.entity.id };

      changes.forEach((change) => {
        if (change.fieldName === "caption") {
          overlayData.caption = String(change.newValue ?? "");
        }
      });

      await trpc.overlay.updateOverlay.mutate(overlayData);

      // AI : Invalidate all mode caches for this city (update affects all modes)
      const cityId = context.entity.project?.cityId;
      if (cityId) {
        mapStore.clearCityProjectsCache(cityId);
        mapStore.clearCityStandaloneProjectsCache(cityId);
      }

      // AI : Optimistically update pending overlay in user contributions
      if (overlayData.caption !== undefined) {
        projectStore.updateOverlayInUserContributions(context.entity.id, {
          name: overlayData.caption || "Unnamed",
        });
      }
    } else {
      // AI : Create new overlay - this is handled by useOverlayPublisher
      throw new Error("New overlay creation should use useOverlayPublisher directly");
    }
  }

  // AI : Unified submission handler - routes to correct backend API
  async function submit(context: SubmissionContext, customReason?: string): Promise<void> {
    // AI : Validate first
    const validation: ValidationResult = validate(context);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(", "));
    }

    // AI : Detect changes with explicit type, passing custom reason if provided
    const changes: FieldChange[] = detectChanges(context, customReason ?? undefined);

    // AI : Route to appropriate submission handler
    if (context.entityType === "project") {
      await submitProject(context, changes);
    } else {
      await submitOverlay(context, changes);
    }
  }

  return {
    getChangeType,
    createProjectContext,
    createOverlayContext,
    detectChanges,
    buildSummary,
    validate,
    submit,
  };
}
