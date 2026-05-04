import {
  showSubmissionDialog,
  submissionSummary,
  pendingSubmissionContext,
  isSubmitting,
} from "./submissionDialogState";
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
  type SubmissionChange,
  type SubmissionChangeType,
  type SubmissionContextExtended,
  isSubmissionContextExtended,
} from "./useSubmissionService";
import L from "leaflet";
import { t } from "@/locales";
import { buildThumbnailUrl } from "@/utils/imageUrl";
import { updateMarkerTooltip, updateMarkerPosition } from "@/services/overlay/overlayMarkers";
import { deleteOverlayDirect } from "@/services/core/entityRemoval";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import type {
  OverlayObject,
  Project,
  ProjectForModeration,
  RemovableChange,
  OverlayForModeration,
  ModifiableField,
} from "@/types/index";

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

// Build changes for NEW overlays (status is null, never submitted to backend)
function buildNewOverlayChanges(
  newOverlayIds: string[],
  overlays: Record<string, OverlayObject | OverlayForModeration>,
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  // Helper to get image URL for new overlays
  // OverlayObject has imageUrl, OverlayForModeration doesn't - fall back to thumbnail
  function getImageUrl(overlay: OverlayObject | OverlayForModeration) {
    if ("imageUrl" in overlay && overlay.imageUrl) return overlay.imageUrl;
    if (overlay.filename) return buildThumbnailUrl(overlay.filename, true);
    return undefined;
  }

  for (const overlayId of newOverlayIds) {
    const overlay = overlays[overlayId];
    if (!overlay) continue;

    const imageUrl = getImageUrl(overlay);
    const overlayName = overlay.caption;

    changes.push({
      field: "new_overlay",
      oldValue: t("common.noValue"),
      newValue: overlayName ?? t("submission.newOverlay"),
      displayLabel: t("submission.newOverlay"),
      overlayId,
      thumbnailUrl: imageUrl,
    });
  }
  return changes;
}

function buildOverlayInfoMap(
  pendingMods: PendingOverlayModification[],
  newOverlayIds: string[],
  project: Project | ProjectForModeration,
  storeOverlays: Record<string, OverlayObject>,
): Record<string, OverlayObject | OverlayForModeration> {
  const overlayInfoMap: Record<string, OverlayObject | OverlayForModeration> = {};

  for (const mod of pendingMods) {
    const storeOverlay = storeOverlays[mod.overlayId];
    if (storeOverlay) {
      overlayInfoMap[mod.overlayId] = storeOverlay;
    } else if ("overlays" in project) {
      const projOverlay = project.overlays.find((o) => o.id === mod.overlayId);
      if (projOverlay) {
        overlayInfoMap[mod.overlayId] = projOverlay;
      }
    }
  }

  for (const overlayId of newOverlayIds) {
    const storeOverlay = storeOverlays[overlayId];
    if (storeOverlay) {
      overlayInfoMap[overlayId] = storeOverlay;
    }
  }

  return overlayInfoMap;
}

function buildProjectWithOverlaysChanges(
  pendingMods: PendingOverlayModification[],
  newOverlayIds: string[],
  overlayInfoMap: Record<string, OverlayObject | OverlayForModeration>,
  projectChanges: SubmissionChange[],
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  if (newOverlayIds.length > 0) {
    const newOverlayChanges = buildNewOverlayChanges(newOverlayIds, overlayInfoMap);
    changes.push(...newOverlayChanges);
  }

  if (pendingMods.length > 0) {
    const modsForExistingOverlays = pendingMods.filter(
      (mod) => !newOverlayIds.includes(mod.overlayId),
    );
    if (modsForExistingOverlays.length > 0) {
      const modChanges = buildOverlayModificationChanges(modsForExistingOverlays, overlayInfoMap);
      changes.push(...modChanges);
    }
  }

  changes.push(...projectChanges);

  return changes;
}

function resetOverlayField(
  field: ModifiableField,
  overlayId: string,
  overlayObject: OverlayObject,
  capturedOriginalCaption: string | null | undefined,
  capturedOriginalCorners: { lat: number; lng: number }[] | null | undefined,
): void {
  const overlayStore = useOverlayStore();

  if (field === "corners") {
    overlayStore.removeFromEditModeCache(overlayId);

    const cornersToUse = capturedOriginalCorners ?? overlayObject.corners;
    const overlayLayer = registry.getLayer(overlayId);
    if (overlayLayer && cornersToUse.length === 4) {
      const leafletCorners = cornersToUse.map((corner) => L.latLng(corner.lat, corner.lng));
      overlayLayer.setCorners(leafletCorners);
    }

    updateMarkerPosition(overlayObject);
    // oxlint-disable-next-line no-unnecessary-condition
  } else if (field === "caption" && capturedOriginalCaption !== undefined) {
    overlayStore.updateOverlay(overlayId, { caption: capturedOriginalCaption ?? "" });
  }
}

function resetOverlayFieldModification(
  overlayId: string,
  field: ModifiableField,
  overlayObject: OverlayObject,
): boolean {
  const pendingModsStore = usePendingModificationsStore();
  const overlayStore = useOverlayStore();

  const pendingMod = pendingModsStore.getPendingModifications(overlayId);
  const capturedOriginalCaption = pendingMod?.caption?.original;
  const capturedOriginalCorners = pendingMod?.corners?.original;

  const hasRemainingMods = pendingModsStore.clearFieldModification(overlayId, field);

  resetOverlayField(
    field,
    overlayId,
    overlayObject,
    capturedOriginalCaption,
    capturedOriginalCorners,
  );

  if (!hasRemainingMods) {
    overlayStore.updateOverlay(overlayId, { isModified: false });
  }

  const overlay = overlayStore.overlays[overlayId];
  if (overlay) {
    updateMarkerTooltip(overlay);
  }

  return hasRemainingMods;
}

// Determine if submission requires moderation based on approval status
function checkRequiresModeration(
  overlayMods: PendingOverlayModification[],
  projectStatus: string | null,
  newOverlayIds?: string[],
): boolean {
  // New overlays always require moderation
  if (newOverlayIds && newOverlayIds.length > 0) {
    return true;
  }
  return (
    overlayMods.some((mod) => mod.overlayStatus === "approved") || projectStatus === "approved"
  );
}

// Determine change type based on submission context
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
  const toast = useToast();
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const pendingModsStore = usePendingModificationsStore();
  const submissionService = useSubmissionService();

  function getNewOverlaysForProject(projectId: string): OverlayObject[] {
    return Object.values(overlayStore.overlays).filter(
      (overlay) => overlay.projectId === projectId && overlay.status === null,
    );
  }

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

  // Prepare combined project+overlay submission. Used by both ContributePanel and InfoPopup.
  function prepareProjectWithOverlaysSubmission(
    project: Project | ProjectForModeration,
    projectHasChanges: boolean,
  ): void {
    try {
      const pendingMods = pendingModsStore.getModificationsForProject(project.id);
      const modifiedOverlayIds = pendingMods.map((mod) => mod.overlayId);

      // Get new overlays (status is null, never submitted to backend)
      const newOverlays = getNewOverlaysForProject(project.id);
      const newOverlayIds = newOverlays.map((o) => o.id);

      // Build overlay info map for thumbnails
      const overlayInfoMap = buildOverlayInfoMap(
        pendingMods,
        newOverlayIds,
        project,
        overlayStore.overlays,
      );

      // Calculate project changes if project has modifications
      const projectChanges: SubmissionChange[] = [];
      if (projectHasChanges) {
        const fullProject = projectStore.projects[project.id];
        if (fullProject) {
          const projectContext = submissionService.createProjectContext(fullProject);
          const projectSummary = submissionService.buildSummary(projectContext);
          projectChanges.push(...projectSummary.changes);
        }
      }

      // Build consolidated changes list
      const changes = buildProjectWithOverlaysChanges(
        pendingMods,
        newOverlayIds,
        overlayInfoMap,
        projectChanges,
      );

      // Determine submission metadata
      const requiresModeration = checkRequiresModeration(
        pendingMods,
        project.status,
        newOverlayIds,
      );
      const projectIsNew = project.status === null;
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
      uiStore.submissionDialogVisible = true;
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

  // Prepare overlay submission. Delegates to prepareProjectWithOverlaysSubmission when a project is available.
  function prepareOverlaySubmission(overlay: OverlayObject, project?: Project): void {
    if (project) {
      const projectModified = project.isModified ?? false;
      prepareProjectWithOverlaysSubmission(project, projectModified);
      return;
    }

    // Fallback for overlays without a project (should be rare)
    const projectId = overlay.projectId;
    const allProjectMods = projectId ? pendingModsStore.getModificationsForProject(projectId) : [];
    // Check if overlay is new (status null, never submitted)
    const overlayIsNew = overlay.status === null;

    const hasAnyOverlayMods =
      allProjectMods.length > 0 ||
      pendingModsStore.hasPendingModifications(overlay.id) ||
      (overlay.isModified ?? false) ||
      overlayIsNew;

    if (!hasAnyOverlayMods) {
      return;
    }

    // Build combined changes list from ALL overlays
    const changes = buildOverlayModificationChanges(allProjectMods, overlayStore.overlays);

    // Add change for new overlay if applicable
    if (overlayIsNew && !allProjectMods.some((mod) => mod.overlayId === overlay.id)) {
      const newOverlayChanges = buildNewOverlayChanges([overlay.id], overlayStore.overlays);
      changes.push(...newOverlayChanges);
    }

    // Determine if this requires moderation
    const requiresModeration = overlayIsNew || overlay.status === "approved";

    // Determine action label
    let action = "";
    if (overlayIsNew) {
      action = t("overlay.publishOverlay");
    } else if (requiresModeration) {
      action = t("submission.submitChangeRequest");
    } else {
      action = t("submission.updateOverlays");
    }

    // Determine changeType using common helper
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
    uiStore.submissionDialogVisible = true;
  }

  function getSuccessMessage(changeType: string): string {
    if (changeType === "update_approved") return t("submission.changeRequestSubmitted");
    if (changeType === "update_pending") return t("submission.changesSaved");
    return t("submission.submissionSuccessful");
  }

  function handleSubmissionSuccess(context: SubmissionContext | SubmissionContextExtended): void {
    const message = getSuccessMessage(context.changeType);

    toast.add({
      severity: "success",
      summary: t("common.success"),
      detail: message,
      life: 3000,
    });

    // Close dialog and reset state
    showSubmissionDialog.value = false;
    uiStore.submissionDialogVisible = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  }

  async function confirmSubmission(reason: string): Promise<void> {
    if (!pendingSubmissionContext.value) return;

    try {
      isSubmitting.value = true;
      const context = pendingSubmissionContext.value;

      // Check if this is an extended context (combined overlay+project submission)
      if (isSubmissionContextExtended(context)) {
        await submissionService.submitExtendedContext(context, reason);
        overlayStore.hideInfoPopup();
      } else {
        // Standard single-entity submission
        await submissionService.submitStandardContext(context as SubmissionContext, reason);
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

  function cancelSubmission(): void {
    showSubmissionDialog.value = false;
    uiStore.submissionDialogVisible = false;
    pendingSubmissionContext.value = null;
    submissionSummary.value = null;
  }

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

  async function handleRemoveOverlayChange(
    overlayId: string,
    field: RemovableChange,
  ): Promise<void> {
    const overlayObject = overlayStore.overlays[overlayId];

    // Handle removing a NEW overlay completely
    if (field === "new_overlay") {
      if (overlayObject?.status === null) {
        await deleteOverlayDirect(overlayId);

        // Update the extended context to remove from newOverlayIds
        if (isSubmissionContextExtended(pendingSubmissionContext.value)) {
          const extCtx = pendingSubmissionContext.value;
          if (extCtx.newOverlayIds) {
            extCtx.newOverlayIds = extCtx.newOverlayIds.filter((id) => id !== overlayId);
          }
        }
      }
      return;
    }

    // Handle resetting a field modification (geometry is never an overlay field)
    if (overlayObject) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const hasRemainingMods = resetOverlayFieldModification(
        overlayId,
        field as ModifiableField,
        overlayObject,
      );
      if (!hasRemainingMods) {
        updateExtendedContextAfterOverlayRemoval(overlayId);
      }
    }
  }

  function handleRemoveProjectChange(field: string): void {
    if (isSubmissionContextExtended(pendingSubmissionContext.value)) {
      const extCtx = pendingSubmissionContext.value;
      if (extCtx.projectId) {
        projectStore.resetProjectField(extCtx.projectId, field);
      }
    } else if (pendingSubmissionContext.value?.entityType === "project") {
      projectStore.resetProjectField(pendingSubmissionContext.value.entityId, field);
    }

    // Close project edit form to force fresh data on reopen
    uiStore.closeProjectEditForm();
  }

  async function handleRemoveChange(
    index: number,
    field: RemovableChange,
    overlayId?: string,
  ): Promise<void> {
    if (!submissionSummary.value) return;

    // Remove the change at the specified index from the summary
    submissionSummary.value.changes.splice(index, 1);

    if (overlayId) {
      await handleRemoveOverlayChange(overlayId, field);
    } else {
      handleRemoveProjectChange(field);
    }

    // If no more changes, close the dialog
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
    // State
    showSubmissionDialog,
    submissionSummary,
    isSubmitting,

    // Prepare submission methods
    prepareProjectWithOverlaysSubmission,
    prepareOverlaySubmission,

    // Dialog actions
    confirmSubmission,
    cancelSubmission,
    handleRemoveChange,
  };
}
