// AI : Shared composable for submission dialog state and handlers
// AI : Eliminates duplication between ContributePanel and PopupContainer
import { ref } from "vue";
import L from "leaflet";
import { useI18n } from "vue-i18n";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";
import {
  usePendingModificationsStore,
  type PendingOverlayModification,
} from "@/stores/pinia/pendingModificationsStore";
import { useToast } from "@/composables/ui/useToast";
import {
  useSubmissionService,
  type SubmissionContext,
  type SubmissionSummary,
  type SubmissionChange,
  type SubmissionChangeType,
} from "./useSubmissionService";
import { useOverlayPublisher } from "@/composables/overlay/useOverlayPublisher";
import { updateMarkerTooltip, updateMarkerPosition } from "@/services/overlay/overlayMarkers";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { trpc } from "@/client";
import type {
  OverlayObject,
  Project,
  ProjectForModeration,
  OverlayForModeration,
  ModifiableField,
  RemovableChange,
} from "@/types/index";

// AI : Extended context type for combined overlay+project submissions
// AI : Separate interface to avoid discriminated union issues
export interface SubmissionContextExtended {
  entityType: "project" | "overlay";
  entityId: string;
  changeType: "create" | "update_pending" | "update_approved";
  entity: OverlayObject | Project;
  projectId?: string;
  projectModified?: boolean;
  overlayModified?: boolean;
  allProjectModifications?: PendingOverlayModification[];
  pendingOverlayModifications?: string[];
  // AI : IDs of new overlays that haven't been submitted to backend yet (status is null)
  newOverlayIds?: string[];
}

// AI : Type predicate for checking if context is extended type
function isSubmissionContextExtended(ctx: unknown): ctx is SubmissionContextExtended {
  return (
    ctx !== null &&
    typeof ctx === "object" &&
    ("overlayModified" in ctx ||
      "pendingOverlayModifications" in ctx ||
      "allProjectModifications" in ctx)
  );
}

// AI : Apply pending modifications to overlay object
function applyModificationsToOverlay(
  overlay: OverlayObject,
  mod: PendingOverlayModification,
): OverlayObject {
  return {
    ...overlay,
    caption: mod.caption?.current ?? overlay.caption,
    corners: mod.corners?.current ?? overlay.corners,
  };
}

// AI : Determine if submission requires moderation based on approval status
function checkRequiresModeration(
  overlayMods: PendingOverlayModification[],
  projectStatus: string | null,
  overlayStatus?: string | null,
  newOverlayIds?: string[],
): boolean {
  // AI : New overlays always require moderation
  if (newOverlayIds && newOverlayIds.length > 0) {
    return true;
  }
  return (
    overlayMods.some((mod) => mod.overlayStatus === "approved") ||
    projectStatus === "approved" ||
    overlayStatus === "approved"
  );
}

// AI : Determine change type based on submission context
function determineChangeType(
  projectIsNew: boolean,
  newOverlayIds: string[],
  requiresModeration: boolean,
): SubmissionChangeType {
  if (projectIsNew || newOverlayIds.length > 0) return "create";
  if (requiresModeration) return "update_approved";
  return "update_pending";
}

export function useSubmissionDialog() {
  const { t } = useI18n();
  const toast = useToast();
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const pendingModsStore = usePendingModificationsStore();
  const submissionService = useSubmissionService();
  const { publishOverlay } = useOverlayPublisher();

  // AI : Shared dialog state
  const showSubmissionDialog = ref(false);
  const submissionSummary = ref<SubmissionSummary | null>(null);
  const pendingSubmissionContext = ref<SubmissionContext | SubmissionContextExtended | null>(null);
  const isSubmitting = ref(false);

  // AI : Build human-readable changes from pending modifications
  function buildOverlayModificationChanges(
    mods: PendingOverlayModification[],
    overlays: Record<string, OverlayObject | OverlayForModeration>,
  ): SubmissionChange[] {
    const changes: SubmissionChange[] = [];

    for (const mod of mods) {
      const overlay = overlays[mod.overlayId];
      const thumbnailUrl = overlay?.filename
        ? buildThumbnailUrl(overlay.filename, overlay.status !== "approved")
        : undefined;

      if (mod.caption) {
        changes.push({
          field: "caption",
          oldValue: mod.caption.original ?? t("common.noValue"),
          newValue: mod.caption.current,
          displayLabel: t("submission.overlayCaption"),
          overlayId: mod.overlayId,
          thumbnailUrl,
        });
      }
      if (mod.corners) {
        changes.push({
          field: "corners",
          oldValue: t("submission.previousPosition"),
          newValue: t("submission.newPosition"),
          displayLabel: t("submission.overlayPosition"),
          overlayId: mod.overlayId,
          thumbnailUrl,
        });
      }
    }
    return changes;
  }

  // AI : Build changes for NEW overlays (status is null, never submitted to backend)
  function buildNewOverlayChanges(
    newOverlayIds: string[],
    overlays: Record<string, OverlayObject | OverlayForModeration>,
  ): SubmissionChange[] {
    const changes: SubmissionChange[] = [];

    for (const overlayId of newOverlayIds) {
      const overlay = overlays[overlayId];
      if (!overlay) continue;

      // AI : For new overlays, use imageUrl (data URL/blob) since they don't have thumbnails yet
      // AI : OverlayObject has imageUrl, OverlayForModeration doesn't - fall back to thumbnail
      function getImageUrl(): string | undefined {
        if ("imageUrl" in overlay && overlay.imageUrl) return overlay.imageUrl;
        if (overlay.filename) return buildThumbnailUrl(overlay.filename, true);
        return undefined;
      }
      const imageUrl = getImageUrl();

      // AI : Handle both OverlayObject (caption) and OverlayForModeration (name)
      const overlayName = "caption" in overlay ? overlay.caption : overlay.name;

      changes.push({
        field: "new_overlay",
        oldValue: t("common.noValue"),
        newValue: overlayName ?? t("submission.newOverlay"),
        displayLabel: t("submission.newOverlay"),
        overlayId: overlayId,
        thumbnailUrl: imageUrl,
      });
    }
    return changes;
  }

  // AI : Get all new/unpublished overlays for a project from the overlay store
  function getNewOverlaysForProject(projectId: string): OverlayObject[] {
    return Object.values(overlayStore.overlays).filter(
      (overlay) =>
        overlay.projectId === projectId &&
        (overlay.status === null || overlay.status === undefined),
    );
  }

  // AI : Helper to append project changes to changes array if project is modified
  function appendProjectChanges(
    changes: SubmissionChange[],
    projectId: string,
    projectModified: boolean,
  ): void {
    if (projectModified) {
      const fullProject = projectStore.projects[projectId];
      if (fullProject) {
        const projectContext = submissionService.createProjectContext(fullProject);
        const projectSummary = submissionService.buildSummary(projectContext);
        changes.push(...projectSummary.changes);
      }
    }
  }

  // AI : Build overlay info map for both modified and new overlays
  function buildOverlayInfoMap(
    pendingMods: PendingOverlayModification[],
    newOverlayIds: string[],
    project: Project | ProjectForModeration,
  ): Record<string, OverlayObject | OverlayForModeration> {
    const overlayInfoMap: Record<string, OverlayObject | OverlayForModeration> = {};

    // AI : Add pending modification overlays
    for (const mod of pendingMods) {
      const storeOverlay = overlayStore.overlays[mod.overlayId];
      if (storeOverlay) {
        overlayInfoMap[mod.overlayId] = storeOverlay;
      } else if ("overlays" in project && project.overlays) {
        // AI : Fall back to project.overlays array (only available on ProjectForModeration)
        const projOverlay = project.overlays.find((o) => o.id === mod.overlayId);
        if (projOverlay) {
          overlayInfoMap[mod.overlayId] = projOverlay;
        }
      }
    }

    // AI : Add new overlays to the info map
    for (const overlayId of newOverlayIds) {
      const storeOverlay = overlayStore.overlays[overlayId];
      if (storeOverlay) {
        overlayInfoMap[overlayId] = storeOverlay;
      }
    }

    return overlayInfoMap;
  }

  // AI : Build consolidated changes list for project with overlays submission
  function buildProjectWithOverlaysChanges(
    pendingMods: PendingOverlayModification[],
    newOverlayIds: string[],
    overlayInfoMap: Record<string, OverlayObject | OverlayForModeration>,
    projectId: string,
    projectHasChanges: boolean,
  ): SubmissionChange[] {
    const changes: SubmissionChange[] = [];

    // AI : Add changes for NEW overlays first (takes priority)
    if (newOverlayIds.length > 0) {
      const newOverlayChanges = buildNewOverlayChanges(newOverlayIds, overlayInfoMap);
      changes.push(...newOverlayChanges);
    }

    // AI : Add overlay modification changes ONLY for non-new overlays
    if (pendingMods.length > 0) {
      const modsForExistingOverlays = pendingMods.filter(
        (mod) => !newOverlayIds.includes(mod.overlayId),
      );
      if (modsForExistingOverlays.length > 0) {
        const modChanges = buildOverlayModificationChanges(modsForExistingOverlays, overlayInfoMap);
        changes.push(...modChanges);
      }
    }

    // AI : Add project changes if project has modifications
    appendProjectChanges(changes, projectId, projectHasChanges);

    return changes;
  }

  // AI : Determine submission action label based on project and overlay states
  function determineSubmissionAction(
    projectIsNew: boolean,
    requiresModeration: boolean,
    projectHasChanges: boolean,
    newOverlayIds: string[],
  ): string {
    if (projectIsNew) return t("project.publish");
    if (requiresModeration) return t("submission.submitChangeRequest");
    if (projectHasChanges) return t("submission.updateProject");
    if (newOverlayIds.length > 0) return t("overlay.publishOverlay");
    return t("submission.updateOverlays");
  }

  // AI : Helper function to submit pending overlay modification (can update directly)
  async function submitPendingOverlayModification(
    overlayId: string,
    mod: PendingOverlayModification,
    overlayObject: OverlayObject,
    project?: Project | null,
  ): Promise<void> {
    if (mod.corners && overlayObject) {
      // AI : For pending overlays with position changes, use publishOverlay
      const overlayToPublish = applyModificationsToOverlay(overlayObject, mod);
      await publishOverlay(overlayToPublish, project ?? null);
    } else if (mod.caption) {
      // AI : Caption-only change for pending overlay
      await trpc.overlay.updateOverlay.mutate({
        id: overlayId,
        caption: mod.caption.current,
      });
    }
  }

  // AI : Helper function to submit approved overlay change request
  async function submitApprovedOverlayChangeRequest(
    overlayId: string,
    mod: PendingOverlayModification,
  ): Promise<void> {
    const changes: {
      fieldName: string;
      oldValue: any;
      newValue: any;
      changeReason?: string;
    }[] = [];

    if (mod.caption) {
      changes.push({
        fieldName: "caption",
        oldValue: mod.caption.original,
        newValue: mod.caption.current,
        changeReason: undefined,
      });
    }
    if (mod.corners) {
      changes.push({
        fieldName: "corners",
        oldValue: mod.corners.original,
        newValue: mod.corners.current,
        changeReason: undefined,
      });
    }

    if (changes.length > 0) {
      await trpc.changes.submitChangeRequest.mutate({
        entityType: "overlay",
        entityId: overlayId,
        changes,
      });
    }
  }

  // AI : Submit pending overlay modifications (caption and position changes)
  async function submitOverlayModifications(
    overlayIds: string[],
    project?: Project | null,
  ): Promise<void> {
    for (const overlayId of overlayIds) {
      const mod = pendingModsStore.getPendingModifications(overlayId);
      if (!mod) continue;

      const isApproved = mod.overlayStatus === "approved";
      const overlayObject = overlayStore.overlays[overlayId];

      if (!isApproved) {
        // AI : Pending overlay - can update directly or publish
        await submitPendingOverlayModification(overlayId, mod, overlayObject, project);
      } else {
        // AI : Approved overlay - submit change request
        await submitApprovedOverlayChangeRequest(overlayId, mod);
      }

      // AI : Clear the pending changes after successful submission
      pendingModsStore.clearModification(overlayId);
    }
  }

  // AI : Prepare project submission and show dialog
  function prepareProjectSubmission(project: Project): void {
    try {
      const context = submissionService.createProjectContext(project);
      const validation = submissionService.validate(context);

      if (!validation.isValid) {
        toast.add({
          severity: "error",
          summary: t("toast.validationFailed"),
          detail: validation.errors.join(", "),
          life: 5000,
        });
        return;
      }

      submissionSummary.value = submissionService.buildSummary(context);
      pendingSubmissionContext.value = context;
      showSubmissionDialog.value = true;
    } catch (error: unknown) {
      console.error("Error preparing submission:", error);
      toast.add({
        severity: "error",
        summary: t("common.error"),
        detail: error instanceof Error ? error.message : t("errors.preparingSubmission"),
        life: 5000,
      });
    }
  }

  // AI : Prepare combined project+overlay submission (for save project button)
  // AI : UNIFIED function used by both ContributePanel and InfoPopup for consistent behavior
  function prepareProjectWithOverlaysSubmission(
    project: Project | ProjectForModeration,
    projectHasChanges: boolean,
  ): void {
    try {
      const pendingMods = pendingModsStore.getModificationsForProject(project.id);
      const modifiedOverlayIds = pendingMods.map((mod) => mod.overlayId);

      // AI : Get new overlays (status is null, never submitted to backend)
      const newOverlays = getNewOverlaysForProject(project.id);
      const newOverlayIds = newOverlays.map((o) => o.id);

      // AI : Build overlay info map for thumbnails
      const overlayInfoMap = buildOverlayInfoMap(pendingMods, newOverlayIds, project);

      // AI : Build consolidated changes list
      const changes = buildProjectWithOverlaysChanges(
        pendingMods,
        newOverlayIds,
        overlayInfoMap,
        project.id,
        projectHasChanges,
      );

      // AI : Determine submission metadata
      const requiresModeration = checkRequiresModeration(
        pendingMods,
        project.status,
        null,
        newOverlayIds,
      );
      const projectIsNew = project.status === null || project.status === undefined;
      const action = determineSubmissionAction(
        projectIsNew,
        requiresModeration,
        projectHasChanges,
        newOverlayIds,
      );
      const changeType = determineChangeType(projectIsNew, newOverlayIds, requiresModeration);

      submissionSummary.value = {
        action,
        entityName: project.name,
        changes,
        requiresModeration,
        entityType: projectHasChanges || projectIsNew ? "project" : "overlay",
        changeType,
      };

      const extendedContext: SubmissionContextExtended = {
        entityType: projectHasChanges || projectIsNew ? "project" : "overlay",
        entityId: project.id,
        changeType,
        entity: projectStore.projects[project.id] ?? project,
        projectId: project.id,
        projectModified: projectHasChanges,
        overlayModified: pendingMods.length > 0 || newOverlayIds.length > 0,
        allProjectModifications: pendingMods,
        pendingOverlayModifications: modifiedOverlayIds,
        newOverlayIds,
      };

      pendingSubmissionContext.value = extendedContext;
      showSubmissionDialog.value = true;
    } catch (error: unknown) {
      console.error("Error preparing submission:", error);
      toast.add({
        severity: "error",
        summary: t("common.error"),
        detail: error instanceof Error ? error.message : t("errors.preparingSubmission"),
        life: 5000,
      });
    }
  }

  // AI : Prepare overlay submission (for map popup publish button)
  // AI : This now delegates to prepareProjectWithOverlaysSubmission for UNIFIED behavior
  function prepareOverlaySubmission(overlay: OverlayObject, project: Project | null): void {
    // AI : If we have a project, use the unified function for consistent behavior
    // AI : This ensures InfoPopup and ContributePanel buttons behave identically
    if (project) {
      const projectModified = project.isModified ?? false;
      prepareProjectWithOverlaysSubmission(project, projectModified);
      return;
    }

    // AI : Fallback for overlays without a project (should be rare)
    const projectId = overlay.projectId;
    const allProjectMods = projectId ? pendingModsStore.getModificationsForProject(projectId) : [];
    const currentOverlayMod = pendingModsStore.getPendingModifications(overlay.id);

    // AI : Check if overlay is new (status null, never submitted)
    const overlayIsNew = overlay.status === null || overlay.status === undefined;

    const hasAnyOverlayMods =
      allProjectMods.length > 0 ||
      currentOverlayMod !== null ||
      (overlay.isModified ?? false) ||
      overlayIsNew;

    if (!hasAnyOverlayMods) {
      return;
    }

    // AI : Build combined changes list from ALL overlays
    const changes = buildOverlayModificationChanges(allProjectMods, overlayStore.overlays);

    // AI : Add change for new overlay if applicable
    if (overlayIsNew && !allProjectMods.some((mod) => mod.overlayId === overlay.id)) {
      const newOverlayChanges = buildNewOverlayChanges([overlay.id], overlayStore.overlays);
      changes.push(...newOverlayChanges);
    }

    // AI : Determine if this requires moderation
    const requiresModeration = overlayIsNew || overlay.status === "approved";

    // AI : Determine action label
    let action = "";
    if (overlayIsNew) {
      action = t("overlay.publishOverlay");
    } else if (requiresModeration) {
      action = t("submission.submitChangeRequest");
    } else {
      action = t("submission.updateOverlays");
    }

    // AI : Determine changeType using common helper
    const changeType = determineChangeType(
      overlayIsNew,
      overlayIsNew ? [overlay.id] : [],
      requiresModeration,
    );

    submissionSummary.value = {
      action,
      entityName: overlay.caption ?? t("submission.newOverlay"),
      changes,
      requiresModeration,
      entityType: "overlay",
      changeType,
    };

    const extendedContext: SubmissionContextExtended = {
      entityType: "overlay",
      entityId: overlay.id,
      changeType,
      entity: overlay,
      projectId: projectId ?? undefined,
      projectModified: false,
      overlayModified: hasAnyOverlayMods,
      allProjectModifications: allProjectMods,
      newOverlayIds: overlayIsNew ? [overlay.id] : [],
    };

    pendingSubmissionContext.value = extendedContext;
    showSubmissionDialog.value = true;
  }

  // AI : Helper function to submit a single overlay modification from allProjectModifications
  async function submitSingleOverlayModification(
    mod: PendingOverlayModification,
    projectId: string | undefined,
    reason: string,
  ): Promise<void> {
    const overlayObj = overlayStore.overlays[mod.overlayId];

    if (!overlayObj) {
      console.warn(`Cannot submit changes for overlay ${mod.overlayId}: not loaded`);
      return;
    }

    if (overlayObj.status !== "approved") {
      // AI : Pending overlay - publish directly
      const overlayToPublish = applyModificationsToOverlay(overlayObj, mod);
      // AI : Try multiple store locations for project lookup - approved projects may be in allProjects
      const project = projectId
        ? (projectStore.projects[projectId] ??
          projectStore.allProjects[projectId] ??
          projectStore.nearbyProjects.find((p) => p.id === projectId) ??
          null)
        : null;
      await publishOverlay(overlayToPublish, project);
    } else {
      // AI : Approved overlay - submit change request
      const overlayWithChanges = applyModificationsToOverlay(overlayObj, mod);
      const overlayContext = submissionService.createOverlayContext(
        overlayWithChanges,
        "update_approved",
      );
      await submissionService.submit(overlayContext, reason);
    }

    pendingModsStore.clearModification(mod.overlayId);
  }

  // AI : Helper function to submit project modifications
  async function submitProjectModification(projectId: string, reason: string): Promise<void> {
    const project = projectStore.projects[projectId];
    if (project) {
      const projectContext = submissionService.createProjectContext(project);
      await submissionService.submit(projectContext, reason);
      projectStore.updateProject(project.id, { isModified: false });
    }
  }

  // AI : Submit all overlay modifications from extended context
  async function submitAllOverlayModifications(
    extCtx: SubmissionContextExtended,
    project: Project | null,
    reason: string,
  ): Promise<void> {
    if (extCtx.allProjectModifications && extCtx.allProjectModifications.length > 0) {
      // AI : Filter out new overlays - they're handled by submitAllNewOverlays to avoid duplicate submissions
      const modificationsForExistingOverlays = extCtx.allProjectModifications.filter(
        (mod) => !extCtx.newOverlayIds?.includes(mod.overlayId),
      );

      for (const mod of modificationsForExistingOverlays) {
        await submitSingleOverlayModification(mod, extCtx.projectId, reason);
      }
    } else if (
      extCtx.pendingOverlayModifications &&
      extCtx.pendingOverlayModifications.length > 0
    ) {
      await submitOverlayModifications(extCtx.pendingOverlayModifications, project);
    }
  }

  // AI : Submit all new overlays from extended context
  async function submitAllNewOverlays(
    extCtx: SubmissionContextExtended,
    project: Project | null,
  ): Promise<void> {
    if (extCtx.newOverlayIds && extCtx.newOverlayIds.length > 0) {
      for (const overlayId of extCtx.newOverlayIds) {
        const overlayObj = overlayStore.overlays[overlayId];
        if (overlayObj) {
          await publishOverlay(overlayObj, project);
        }
      }
    }
  }

  // AI : Submit new project creation if applicable
  async function submitNewProjectIfApplicable(
    extCtx: SubmissionContextExtended,
    project: Project | null,
    reason: string,
  ): Promise<void> {
    if (extCtx.entityType === "project" && extCtx.changeType === "create" && project) {
      if (project.status === null || project.status === undefined) {
        await submissionService.submit(
          submissionService.createProjectContext(project, "create"),
          reason,
        );
      }
    }
  }

  // AI : Helper function to handle extended context submission (combined overlay+project)
  async function submitExtendedContext(
    extCtx: SubmissionContextExtended,
    reason: string,
  ): Promise<void> {
    // AI : Try multiple store locations for project lookup - approved projects may be in allProjects
    let project: Project | null = null;
    if (extCtx.projectId) {
      project =
        projectStore.projects[extCtx.projectId] ??
        projectStore.allProjects[extCtx.projectId] ??
        projectStore.nearbyProjects.find((p) => p.id === extCtx.projectId) ??
        null;
    }

    // AI : Submit all overlay modifications (position/caption changes)
    await submitAllOverlayModifications(extCtx, project, reason);

    // AI : Submit all new overlays
    await submitAllNewOverlays(extCtx, project);

    // AI : Submit project changes for EXISTING modified projects only (not new projects)
    // AI : New projects will be handled by ensureProjectOnServer or submitNewProjectIfApplicable
    const isExistingProject = project && project.status !== null && project.status !== undefined;

    // AI : Only submit if project is actually modified AND has detectable changes
    // AI : This prevents "No changes detected" errors when only overlays changed
    if (extCtx.projectModified && extCtx.projectId && isExistingProject && project) {
      // AI : Create project context to detect if there are actual changes
      const projectContext = submissionService.createProjectContext(project);
      const projectChanges = submissionService.detectChanges(projectContext);

      if (projectChanges.length > 0) {
        await submitProjectModification(extCtx.projectId, reason);
      }
    }

    // AI : Submit new project creation if applicable
    // AI : IMPORTANT: Skip if we have new overlays - ensureProjectOnServer already published the project
    // AI : This prevents duplicate publishProject calls (overlay publisher already handled it)
    const hasNewOverlays = extCtx.newOverlayIds && extCtx.newOverlayIds.length > 0;
    if (!hasNewOverlays) {
      await submitNewProjectIfApplicable(extCtx, project, reason);
    }

    overlayStore.hideInfoPopup();
  }

  // AI : Helper function to handle standard single-entity submission
  async function submitStandardContext(context: SubmissionContext, reason: string): Promise<void> {
    // AI : TypeScript discriminated union automatically narrows entity type based on entityType check
    if (context.entityType === "project") {
      await submissionService.submit(
        submissionService.createProjectContext(context.entity, context.changeType),
        reason,
      );
      projectStore.updateProject(context.entityId, { isModified: false });
    } else if (context.entityType === "overlay") {
      await submissionService.submit(
        submissionService.createOverlayContext(context.entity, context.changeType),
        reason,
      );
    }
  }

  // AI : Helper function to get success message based on change type
  function getSuccessMessage(changeType: string): string {
    if (changeType === "update_approved") return t("submission.changeRequestSubmitted");
    if (changeType === "update_pending") return t("submission.changesSaved");
    return t("submission.submissionSuccessful");
  }

  // AI : Helper function to handle submission success
  function handleSubmissionSuccess(context: SubmissionContext | SubmissionContextExtended): void {
    const message = getSuccessMessage(context.changeType);

    toast.add({
      severity: "success",
      summary: t("common.success"),
      detail: message,
      life: 3000,
    });

    // AI : Close dialog and reset state
    showSubmissionDialog.value = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  }

  // AI : Confirm submission after user approves in dialog
  async function confirmSubmission(reason: string): Promise<void> {
    if (!pendingSubmissionContext.value) return;

    try {
      isSubmitting.value = true;
      const context = pendingSubmissionContext.value;

      // AI : Check if this is an extended context (combined overlay+project submission)
      if (isSubmissionContextExtended(context)) {
        await submitExtendedContext(context, reason);
      } else {
        // AI : Standard single-entity submission
        await submitStandardContext(context as SubmissionContext, reason);
      }

      handleSubmissionSuccess(context as SubmissionContext | SubmissionContextExtended);
    } catch (error: unknown) {
      console.error("Error submitting:", error);
      toast.add({
        severity: "error",
        summary: t("toast.submissionFailed"),
        detail: error instanceof Error ? error.message : t("errors.submissionFailed"),
        life: 5000,
      });
    } finally {
      isSubmitting.value = false;
    }
  }

  // AI : Cancel submission dialog
  function cancelSubmission(): void {
    showSubmissionDialog.value = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  }

  // AI : Helper function to reset overlay field to original value
  function resetOverlayField(
    field: ModifiableField,
    overlayId: string,
    overlayObject: OverlayObject,
    capturedOriginalCaption: string | null | undefined,
    capturedOriginalCorners: { lat: number; lng: number }[] | null | undefined,
  ): void {
    if (field === "corners") {
      // AI : Clear from edit mode cache
      overlayStore.removeFromEditModeCache(overlayId);

      // AI : Reset position to backend corners (use captured original if available)
      const cornersToUse = capturedOriginalCorners ?? overlayObject.corners;
      if (overlayObject.overlay && cornersToUse?.length === 4) {
        const leafletCorners = cornersToUse.map((corner) => L.latLng(corner.lat, corner.lng));
        overlayObject.overlay.setCorners(leafletCorners);
      }

      // AI : Update marker position
      updateMarkerPosition(overlayObject);
    } else if (field === "caption") {
      // AI : Reset caption to original backend value
      if (capturedOriginalCaption !== undefined) {
        overlayStore.updateOverlay(overlayId, { caption: capturedOriginalCaption ?? "" });
      }
    }
  }

  // AI : Helper function to update extended context after overlay change removal
  function updateExtendedContextAfterOverlayRemoval(overlayId: string): void {
    if (isSubmissionContextExtended(pendingSubmissionContext.value)) {
      const extCtx = pendingSubmissionContext.value;
      if (extCtx.allProjectModifications) {
        extCtx.allProjectModifications = extCtx.allProjectModifications.filter(
          (mod) => mod.overlayId !== overlayId,
        );
      }
      if (extCtx.pendingOverlayModifications) {
        extCtx.pendingOverlayModifications = extCtx.pendingOverlayModifications.filter(
          (id) => id !== overlayId,
        );
      }
    }
  }

  // AI : Remove a new overlay completely from map and store
  function removeNewOverlayCompletely(overlayId: string, overlayObject: OverlayObject): void {
    // AI : Remove the Leaflet overlay from the map
    if (overlayObject.overlay) {
      overlayObject.overlay.remove();
    }

    // AI : Remove the marker
    const marker = overlayStore.allMarkers[overlayId];
    if (marker) {
      marker.remove();
      const updatedMarkers = { ...overlayStore.allMarkers };
      delete updatedMarkers[overlayId];
      overlayStore.allMarkers = updatedMarkers;
    }

    // AI : Remove the overlay from the store
    const updatedOverlays = { ...overlayStore.overlays };
    delete updatedOverlays[overlayId];
    overlayStore.overlays = updatedOverlays;

    // AI : Remove from project's overlayIds array
    if (overlayObject.projectId) {
      const project = projectStore.projects[overlayObject.projectId];
      if (project) {
        const overlayIndex = project.overlayIds.indexOf(overlayId);
        if (overlayIndex !== -1) {
          project.overlayIds.splice(overlayIndex, 1);
        }
      }
    }

    // AI : Update the extended context to remove from newOverlayIds
    if (isSubmissionContextExtended(pendingSubmissionContext.value)) {
      const extCtx = pendingSubmissionContext.value;
      if (extCtx.newOverlayIds) {
        extCtx.newOverlayIds = extCtx.newOverlayIds.filter((id) => id !== overlayId);
      }
    }
  }

  // AI : Reset a specific overlay field modification
  function resetOverlayFieldModification(
    overlayId: string,
    field: ModifiableField,
    overlayObject: OverlayObject,
  ): void {
    // AI : Capture original values BEFORE clearing
    const pendingMod = pendingModsStore.getPendingModifications(overlayId);
    const capturedOriginalCaption = pendingMod?.caption?.original;
    const capturedOriginalCorners = pendingMod?.corners?.original;

    // AI : Clear the specific field modification
    const hasRemainingMods = pendingModsStore.clearFieldModification(overlayId, field);

    // AI : Reset the field to its original value
    resetOverlayField(
      field,
      overlayId,
      overlayObject,
      capturedOriginalCaption,
      capturedOriginalCorners,
    );

    // AI : Update overlay state
    if (!hasRemainingMods) {
      overlayStore.updateOverlay(overlayId, { isModified: false });
      updateExtendedContextAfterOverlayRemoval(overlayId);
    }

    // AI : Update marker tooltip
    updateMarkerTooltip(overlayStore.overlays[overlayId]);
  }

  // AI : Helper function to handle removing an overlay change
  function handleRemoveOverlayChange(overlayId: string, field: RemovableChange): void {
    const overlayObject = overlayStore.overlays[overlayId];

    // AI : Handle removing a NEW overlay completely
    if (field === "new_overlay") {
      if (overlayObject && (overlayObject.status === null || overlayObject.status === undefined)) {
        removeNewOverlayCompletely(overlayId, overlayObject);
      }
      return;
    }

    // AI : Handle resetting a field modification
    if (overlayObject) {
      resetOverlayFieldModification(overlayId, field, overlayObject);
    }
  }

  // AI : Helper function to handle removing a project change
  function handleRemoveProjectChange(field: string): void {
    // AI : For project changes (no overlayId), reset the project field to its original value
    if (isSubmissionContextExtended(pendingSubmissionContext.value)) {
      const extCtx = pendingSubmissionContext.value;
      if (extCtx.projectId) {
        projectStore.resetProjectField(extCtx.projectId, field);
      }
    } else if (pendingSubmissionContext.value?.entityType === "project") {
      projectStore.resetProjectField(pendingSubmissionContext.value.entityId, field);
    }

    // AI : Close project edit form to force fresh data on reopen
    uiStore.closeProjectEditForm();
  }

  // AI : Handle removing a single change from the submission dialog
  function handleRemoveChange(index: number, field: RemovableChange, overlayId?: string): void {
    if (!submissionSummary.value) return;

    // AI : Remove the change at the specified index from the summary
    submissionSummary.value.changes.splice(index, 1);

    if (overlayId) {
      handleRemoveOverlayChange(overlayId, field);
    } else {
      handleRemoveProjectChange(field);
    }

    // AI : If no more changes, close the dialog
    if (submissionSummary.value.changes.length === 0) {
      cancelSubmission();
      toast.add({
        severity: "info",
        summary: t("common.info"),
        detail: t("submission.noChangesToSubmit"),
        life: 3000,
      });
    }
  }

  return {
    // AI : State
    showSubmissionDialog,
    submissionSummary,
    isSubmitting,

    // AI : Prepare submission methods
    prepareProjectSubmission,
    prepareProjectWithOverlaysSubmission,
    prepareOverlaySubmission,

    // AI : Dialog actions
    confirmSubmission,
    cancelSubmission,
    handleRemoveChange,

    // AI : Helpers (exposed for specific use cases)
    buildOverlayModificationChanges,
    submitOverlayModifications,
  };
}
