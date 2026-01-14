import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { trpc } from "@/client";
import { buildProjectPayload } from "@/composables/project/useProjectMutations";
import {
  loadCityProjects,
  updateStandaloneProjectMarkerColor,
} from "@/composables/map/useCityMarkers";
import { updateMarkerTooltip } from "@/composables/overlay/useOverlayMarkers";
import { getFromEditModeOverlayCache } from "@/composables/overlay/useOverlayPositionManagement";
import type { Project, OverlayObject, OverlayData } from "@/types/index";
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
  // AI : Optional overlay identification for deletion and thumbnail display
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
  const overlayStore = useOverlayStore();
  const { resetChangeRequestsLoaded, refreshPendingChangeRequests } = useChangeRequests();

  // AI : Build a combined city name cache from store cache + projects we've seen
  const cityNamesCache = computed(() => {
    const cache: Record<string, string> = { ...projectStore.cityNamesCache };

    // AI : Extract from all projects (includes both loaded and original cached projects)
    for (const project of Object.values(projectStore.allProjects)) {
      if (
        project.city &&
        project.cityId &&
        project.city.id === project.cityId &&
        !cache[project.cityId]
      ) {
        cache[project.cityId] = project.city.name;
      }
    }

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

    // AI : Use centralized helper to find original project from either cache
    const originalProject = projectStore.getOriginalProject(project.id);

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

    for (const field of fieldsToCheck) {
      // AI : Cast to any as originalProject can be Project or UserContribution, both have these fields
      const oldValue = (originalProject as unknown as Record<string, unknown>)[field];
      const newValue = project[field];

      // AI : Special handling for date fields
      const isDateField = ["proposalDate", "startDate", "endDate", "latestUpdateOn"].includes(
        String(field),
      );

      // AI : For change requests, preserve empty strings (database requires non-null new_value)
      // AI : Only normalize dates; for other fields, use empty string instead of null
      let normalizedOld: any;
      let normalizedNew: any;

      if (isDateField) {
        normalizedOld = normalizeDate(oldValue);
        normalizedNew = normalizeDate(newValue);
      } else {
        // AI : Convert null/undefined to empty string, preserve actual values
        normalizedOld = oldValue ?? "";
        normalizedNew = newValue ?? "";
      }

      if (normalizedOld !== normalizedNew) {
        changes.push({
          fieldName: String(field),
          oldValue: normalizedOld,
          newValue: normalizedNew,
          changeReason: customReason ?? undefined,
        });
      }
    }

    return changes;
  }

  // AI : Detect all changes for an overlay entity
  function findOriginalOverlay(overlay: OverlayObject): OverlayData | undefined {
    // AI : Find original overlay data from backend cache (must use cache to get corners!)
    // AI : currentCityOverlays doesn't have corners, we need to fetch from the city cache
    let originalOverlay: OverlayData | undefined;

    // AI : Get cityId from the overlay's project
    const cityId = overlay.project?.cityId;

    if (cityId) {
      // AI : Try view mode cache first (contains original backend data)
      let cachedOverlays = mapStore.getCityOverlaysAndProjectsCache(cityId, "view");

      // AI : If view cache is empty, try edit mode cache (also contains backend data)
      // AI : This handles the case where user clicked city marker directly instead of zooming
      if (!cachedOverlays || cachedOverlays.length === 0) {
        cachedOverlays = mapStore.getCityOverlaysAndProjectsCache(cityId, "edit");
      }

      originalOverlay = cachedOverlays?.find((o) => o.id === overlay.id);
    }

    if (!originalOverlay) {
      // AI : For pending overlays or if not found in cache, check user contributions
      const contribution = projectStore.userContributions.find((c) =>
        c.overlays?.some((o) => o.id === overlay.id),
      );
      const overlayFromContributions = contribution?.overlays?.find((o) => o.id === overlay.id);

      if (overlayFromContributions) {
        // AI : Convert to the format we need for comparison
        // AI : Don't set corners - will use fallback in comparison logic below
        // AI : IMPORTANT: overlayFromContributions.name may be "Unnamed" if caption was null
        // AI : which is just a display value, not an actual caption
        const captionFromContributions = overlayFromContributions.name;
        originalOverlay = {
          id: overlayFromContributions.id,
          // AI : Treat "Unnamed" as empty caption since it's a display placeholder
          caption: captionFromContributions === "Unnamed" ? null : captionFromContributions,
        } as any; // AI : Minimal overlay type for comparison
      }
    }

    return originalOverlay;
  }

  function detectOverlayChanges(overlay: OverlayObject, customReason?: string): FieldChange[] {
    const changes: FieldChange[] = [];

    const originalOverlay = findOriginalOverlay(overlay);

    if (!originalOverlay) {
      // AI : If no original found, this is a new overlay or we can't detect changes
      return changes;
    }

    // AI : Check caption change (don't normalize to null - database requires non-null new_value)
    // AI : Normalize: treat null, undefined, empty string, and "Unnamed" display value as equivalent
    const oldCaption = originalOverlay.caption ?? "";
    const newCaption = overlay.caption ?? "";

    if (oldCaption !== newCaption) {
      changes.push({
        fieldName: "caption",
        oldValue: oldCaption,
        newValue: newCaption,
        changeReason: customReason ?? undefined,
      });
    }

    // AI : Check corner positions - CRITICAL: Prioritize edit mode cache for current corners
    // AI : Priority order for current corners:
    // AI : 1. Edit mode cache (contains user's most recent position, even if zoomed out)
    // AI : 2. Leaflet overlay (if actively loaded in the map)
    // AI : 3. overlay.corners (fallback, but may be stale/original)
    let currentCorners: { lat: number; lng: number }[];

    const editModeCache = getFromEditModeOverlayCache(overlay.id);

    if (editModeCache?.corners?.length === 4) {
      // AI : Use cached corners (user's most recent position in edit mode)
      // AI : No need to check isModified - the comparison will determine if changed
      currentCorners = editModeCache.corners;
    } else if (overlay.overlay) {
      // AI : Use Leaflet overlay corners if currently loaded
      currentCorners = overlay.overlay.getCorners().map((c) => ({ lat: c.lat, lng: c.lng }));
    } else {
      // AI : Fallback to stored corners
      currentCorners = overlay.corners;
    }

    const normalizedCurrentCorners = currentCorners.map((c) => ({ lat: c.lat, lng: c.lng }));

    // AI : Get original corners - for approved overlays use backend data, for pending use stored corners
    const normalizedOriginalCorners = originalOverlay.corners
      ? originalOverlay.corners.map((c: { lat: number; lng: number }) => ({
          lat: c.lat,
          lng: c.lng,
        }))
      : overlay.corners.map((c) => ({ lat: c.lat, lng: c.lng })); // AI : Fallback for pending overlays

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
      changeType: context.changeType,
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
        for (const error of Object.values(zodErrors)) {
          errors.push(t(error.key, error.params ?? {}));
        }
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
        for (const error of Object.values(zodErrors)) {
          errors.push(t(error.key, error.params ?? {}));
        }
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
        mapStore.selectedCity.nameLocal,
        true,
        mapStore.selectedCity.countryCode,
      );
    } else {
      await loadCityProjects(null, "", null, true);
    }

    if (changeType === "create") {
      // AI : Optimistically add project to contributions (status is already "pending" from line 453)
      const updatedProject = projectStore.projects[project.id];
      if (updatedProject) {
        projectStore.addProjectToUserContributions(updatedProject);
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

      // AI : CRITICAL: Also update the overlay in overlayStore so preview buttons work
      const overlayInStore = overlayStore.overlays[context.entity.id];
      if (overlayInStore && cornersChange?.newValue) {
        overlayInStore.suggestedCorners = cornersChange.newValue as { lat: number; lng: number }[];
        overlayInStore.hasPendingChanges = true;
        overlayInStore.isViewingApprovedPosition = false;
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
      await refreshPendingChangeRequests(true); // ForceUserOnly = true for My Contributions
    } else if (context.changeType === "update_pending") {
      // AI : Direct update for pending overlays
      const overlayData: { id: string; caption?: string } = { id: context.entity.id };

      for (const change of changes) {
        if (change.fieldName === "caption") {
          overlayData.caption = String(change.newValue ?? "");
        }
      }

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
