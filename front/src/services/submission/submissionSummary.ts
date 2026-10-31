import type { PendingOverlayModification, OverlayObject, Project } from "@/types/index";
import type {
  ProjectFieldChange,
  SubmissionChange,
  SubmissionDraft,
  SubmissionSummary,
} from "./submissionTypes";
import { t } from "@/locales";
import { buildThumbnailUrl } from "@/utils/imageUrl";

function buildOverlayModificationChanges(
  mods: PendingOverlayModification[],
  overlays: Record<string, OverlayObject>,
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
        oldValue: mod.caption.original ?? "",
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
  overlays: Record<string, OverlayObject>,
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];

  for (const overlayId of newOverlayIds) {
    const overlay = overlays[overlayId];
    if (!overlay) continue;

    changes.push({
      field: "new_overlay",
      oldValue: "",
      newValue: overlay.caption ?? t("submission.newOverlay"),
      displayLabel: t("submission.newOverlay"),
      overlayId,
      thumbnailUrl: overlay.imageUrl,
    });
  }
  return changes;
}

function buildProjectChanges(changes: ProjectFieldChange[]): SubmissionChange[] {
  return changes.map((change) => ({
    field: change.fieldName,
    oldValue: formatValueForDisplay(change, "oldValue"),
    newValue: formatValueForDisplay(change, "newValue"),
    displayLabel: t(`fields.${change.fieldName}`),
  }));
}

function formatValueForDisplay(change: ProjectFieldChange, side: "oldValue" | "newValue"): string {
  const value = change[side];
  if (value === null || value === "") return "";

  if (change.fieldName === "geometry") {
    const geometry = change[side];
    return geometry && geometry.geometries.length > 0
      ? t("shapes.geometrySummary", { count: geometry.geometries.length })
      : "";
  }

  if (Array.isArray(value)) return `[${value.length} items]`;
  return String(value);
}

function getSubmissionPresentation(
  draft: SubmissionDraft,
  project: Project | null,
  overlays: Record<string, OverlayObject>,
) {
  const isCreation = project?.status === null || draft.newOverlayIds.length > 0;
  let changesApprovedEntity = Boolean(draft.projectChanges) && project?.status === "approved";
  for (const modification of draft.overlayModifications) {
    if (overlays[modification.overlayId]?.status === "approved") {
      changesApprovedEntity = true;
      break;
    }
  }
  return {
    isCreation,
    requiresModeration: isCreation || changesApprovedEntity || Boolean(draft.pendingRender),
  };
}

export function buildSubmissionSummary(
  draft: SubmissionDraft,
  project: Project | null,
  overlays: Record<string, OverlayObject>,
): SubmissionSummary {
  const changes = [
    ...buildNewOverlayChanges(draft.newOverlayIds, overlays),
    ...buildOverlayModificationChanges(draft.overlayModifications, overlays),
    ...buildProjectChanges(draft.projectChanges ?? []),
  ];

  if (draft.pendingRender) {
    changes.push({
      field: "render",
      oldValue: "",
      newValue: t("render.imageChange"),
      displayLabel: t("render.label"),
      thumbnailUrl: draft.pendingRender.previewUrl,
    });
  }

  return {
    entityName: draft.entityName,
    changes,
    ...getSubmissionPresentation(draft, project, overlays),
  };
}
