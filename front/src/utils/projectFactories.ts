import type { OverlayData, OverlayForModeration, UserContributionOverlay } from "@/types/index";
import type { ApprovalStatus } from "@shared/types";

// A render staged in the upload dialog but not yet submitted. It lives only in stagedRenderStore
// (no overlay row, no map artifact), so the contributions list synthesizes this entry to show it
// as a pending render before submission. kind 'render' + status null marks it as staged; the
// deterministic id is replaced by the real overlay on submission (addRenderToUserContributions).
export function createStagedRenderOverlay(
  projectId: string,
  previewUrl: string,
  authorId: string | null,
  authorUsername: string | null,
): OverlayForModeration {
  return {
    id: `staged-render-${projectId}`,
    caption: null,
    filename: `staged-render-${projectId}.webp`,
    kind: "render",
    status: null,
    version: 1,
    projectId,
    updatedAt: new Date(),
    authorId,
    authorUsername,
    authorApprovedCount: null,
    authorRejectedCount: null,
    authorReportCount: undefined,
    countryCode: null,
    countryName: null,
    replacesOverlayId: null,
    replacedByOverlayId: null,
    imageUrl: previewUrl,
  };
}

export function createOverlayForModeration(overlayData: OverlayData): OverlayForModeration {
  return {
    id: overlayData.id,
    caption: overlayData.caption,
    filename: overlayData.filename.startsWith("data:")
      ? `pending-${overlayData.id}.webp`
      : overlayData.filename,
    status: overlayData.status,
    version: overlayData.version,
    projectId: overlayData.projectId,
    updatedAt: overlayData.updatedAt,
    authorId: overlayData.authorId,
    authorUsername: undefined,
    authorReportCount: undefined,
    countryCode: overlayData.project?.countryCode ?? null,
    countryName: null,
    replacesOverlayId: overlayData.replacesOverlayId,
    replacedByOverlayId: overlayData.replacedByOverlayId,
    imageUrl: overlayData.filename.startsWith("data:") ? overlayData.filename : undefined,
  };
}

export function createLocalOverlayContribution(
  overlay: {
    id: string;
    caption: string | null;
    filename: string;
    projectId: string | null;
    authorId: string | null;
    replacesOverlayId: string | null;
    replacedByOverlayId?: string | null;
    imageUrl?: string;
    status?: ApprovalStatus | null;
    version?: number;
    updatedAt?: Date;
  },
  parentProject: {
    countryCode: string | null;
    countryName: string | null | undefined;
  },
  username: string | null,
  kind: UserContributionOverlay["kind"] = "map",
): UserContributionOverlay {
  return {
    id: overlay.id,
    caption: overlay.caption,
    filename: overlay.filename,
    kind,
    status: overlay.status !== undefined ? overlay.status : null,
    version: overlay.version ?? 1,
    projectId: overlay.projectId ?? "",
    authorId: overlay.authorId ?? null,
    authorUsername: username,
    authorApprovedCount: null,
    authorRejectedCount: null,
    replacesOverlayId: overlay.replacesOverlayId ?? null,
    replacedByOverlayId: overlay.replacedByOverlayId ?? null,
    updatedAt: overlay.updatedAt ?? new Date(),
    countryCode: parentProject.countryCode,
    countryName: parentProject.countryName ?? null,
    imageUrl: overlay.imageUrl,
  };
}
