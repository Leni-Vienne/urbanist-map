// AI : Shared composable for submission dialog state and handlers
// AI : Eliminates duplication between MyContributionsPanel and PopupContainer
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
} from "./useSubmissionService";
import { useOverlayPublisher } from "@/composables/overlay/useOverlayPublisher";
import { updateMarkerTooltip, updateMarkerPosition } from "@/composables/overlay/useOverlayMarkers";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { trpc } from "@/client";
import type {
  OverlayObject,
  Project,
  ProjectForModeration,
  OverlayForModeration,
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

// AI : Type predicate for field type
function isValidFieldType(field: string): field is "caption" | "corners" {
  return field === "caption" || field === "corners";
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
): boolean {
  return (
    overlayMods.some((mod) => mod.overlayStatus === "approved") ||
    projectStatus === "approved" ||
    overlayStatus === "approved"
  );
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
  function prepareProjectWithOverlaysSubmission(
    project: Project | ProjectForModeration,
    projectHasChanges: boolean,
  ): void {
    try {
      const pendingMods = pendingModsStore.getModificationsForProject(project.id);
      const modifiedOverlayIds = pendingMods.map((mod) => mod.overlayId);

      // AI : Build changes list
      let changes: SubmissionChange[] = [];

      // AI : Add overlay changes
      if (pendingMods.length > 0) {
        // AI : Build overlay info map for thumbnails
        const overlayInfoMap: Record<string, OverlayObject | OverlayForModeration> = {};
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

        changes = buildOverlayModificationChanges(pendingMods, overlayInfoMap);
      }

      // AI : Add project changes if project has modifications
      appendProjectChanges(changes, project.id, projectHasChanges);

      // AI : Determine if this requires moderation
      const requiresModeration = checkRequiresModeration(pendingMods, project.status);

      // AI : Determine action label
      let action = "";
      if (requiresModeration) {
        action = t("submission.submitChangeRequest");
      } else if (projectHasChanges) {
        action = t("submission.updateProject");
      } else {
        action = t("submission.updateOverlays");
      }

      submissionSummary.value = {
        action,
        entityName: project.name,
        changes,
        requiresModeration,
        entityType: projectHasChanges ? "project" : "overlay",
      };

      const extendedContext: SubmissionContextExtended = {
        entityType: projectHasChanges ? "project" : "overlay",
        entityId: project.id,
        changeType: requiresModeration ? "update_approved" : "update_pending",
        entity: projectStore.projects[project.id] ?? project,
        projectId: project.id,
        projectModified: projectHasChanges,
        overlayModified: pendingMods.length > 0,
        allProjectModifications: pendingMods,
        pendingOverlayModifications: modifiedOverlayIds,
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
  function prepareOverlaySubmission(overlay: OverlayObject, project: Project | null): void {
    const projectId = project?.id ?? overlay.projectId;
    const allProjectMods = projectId ? pendingModsStore.getModificationsForProject(projectId) : [];
    const currentOverlayMod = pendingModsStore.getPendingModifications(overlay.id);

    const hasAnyOverlayMods =
      allProjectMods.length > 0 || currentOverlayMod !== null || (overlay.isModified ?? false);
    const projectModified = project?.isModified ?? false;

    if (!hasAnyOverlayMods && !projectModified) {
      return;
    }

    // AI : Build combined changes list from ALL overlays
    const changes = buildOverlayModificationChanges(allProjectMods, overlayStore.overlays);

    // AI : Add project changes if project is modified
    if (project) {
      appendProjectChanges(changes, project.id, projectModified);
    }

    // AI : Determine if this requires moderation
    const requiresModeration = checkRequiresModeration(
      allProjectMods,
      project?.status ?? null,
      overlay.status,
    );

    // AI : Determine action label
    let action = "";
    if (requiresModeration) {
      action = t("submission.submitChangeRequest");
    } else if (overlay.status === "pending" || overlay.status === null) {
      action = t("overlay.publishOverlay");
    } else {
      action = t("submission.updateOverlays");
    }

    submissionSummary.value = {
      action,
      entityName: overlay.caption ?? project?.name ?? "Overlay",
      changes,
      requiresModeration,
      entityType: "overlay",
    };

    const extendedContext: SubmissionContextExtended = {
      entityType: "overlay",
      entityId: overlay.id,
      changeType: requiresModeration ? "update_approved" : "update_pending",
      entity: overlay,
      projectId: project?.id,
      projectModified,
      overlayModified: hasAnyOverlayMods,
      allProjectModifications: allProjectMods,
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
      const project = projectId ? projectStore.projects[projectId] : null;
      await publishOverlay(overlayToPublish, project ?? null);
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

  // AI : Helper function to handle extended context submission (combined overlay+project)
  async function submitExtendedContext(
    extCtx: SubmissionContextExtended,
    reason: string,
  ): Promise<void> {
    // AI : Handle ALL overlay changes
    if (extCtx.allProjectModifications && extCtx.allProjectModifications.length > 0) {
      for (const mod of extCtx.allProjectModifications) {
        await submitSingleOverlayModification(mod, extCtx.projectId, reason);
      }
    } else if (
      extCtx.pendingOverlayModifications &&
      extCtx.pendingOverlayModifications.length > 0
    ) {
      // AI : Handle overlay IDs array format (from MyContributionsPanel)
      const project = extCtx.projectId ? projectStore.projects[extCtx.projectId] : null;
      await submitOverlayModifications(extCtx.pendingOverlayModifications, project);
    }

    // AI : Handle project changes
    if (extCtx.projectModified && extCtx.projectId) {
      await submitProjectModification(extCtx.projectId, reason);
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
    field: string,
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

  // AI : Helper function to handle removing an overlay change
  function handleRemoveOverlayChange(overlayId: string, field: string): void {
    // AI : CRITICAL: Capture original values BEFORE clearing (this fixes the bug)
    const pendingMod = pendingModsStore.getPendingModifications(overlayId);
    const capturedOriginalCaption = pendingMod?.caption?.original;
    const capturedOriginalCorners = pendingMod?.corners?.original;

    const overlayObject = overlayStore.overlays[overlayId];

    // AI : Clear only the specific field modification (not the entire overlay)
    // AI : This MUTATES the pendingMod object, so we captured values above
    if (!isValidFieldType(field)) {
      console.warn("Invalid field type:", field);
      return;
    }
    const hasRemainingMods = pendingModsStore.clearFieldModification(overlayId, field);

    if (overlayObject) {
      // AI : Reset only the specific field that was removed
      resetOverlayField(
        field,
        overlayId,
        overlayObject,
        capturedOriginalCaption,
        capturedOriginalCorners,
      );

      // AI : Only mark as unmodified if no more modifications remain
      if (!hasRemainingMods) {
        overlayStore.updateOverlay(overlayId, { isModified: false });
      }

      // AI : Update marker tooltip to reflect new state
      updateMarkerTooltip(overlayStore.overlays[overlayId]);
    }

    // AI : Update the extended context if present and no more mods for this overlay
    if (!hasRemainingMods) {
      updateExtendedContextAfterOverlayRemoval(overlayId);
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
  function handleRemoveChange(index: number, field: string, overlayId?: string): void {
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
