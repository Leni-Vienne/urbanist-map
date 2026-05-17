import type {
  OverlayData,
  Project,
  ProjectForModeration,
  OverlayForModeration,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import type { ApprovalStatus } from "@shared/types";

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
    cityId: overlayData.project?.cityId ?? null,
    cityName: overlayData.project?.city?.name ?? null,
    countryCode: overlayData.project?.city?.countryCode ?? overlayData.project?.countryCode ?? null,
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
    cityId: number | null;
    cityName: string | null;
    countryCode: string | null;
    countryName: string | null;
  },
  username: string | null,
): UserContributionOverlay {
  return {
    id: overlay.id,
    caption: overlay.caption,
    filename: overlay.filename,
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
    cityId: parentProject.cityId,
    cityName: parentProject.cityName,
    countryCode: parentProject.countryCode,
    countryName: parentProject.countryName,
    imageUrl: overlay.imageUrl,
  };
}

export function createLocalProjectContribution(
  project: Project,
  overlays: UserContributionOverlay[],
  username: string | null,
): UserContribution {
  return {
    ...project,
    overlays,
    overlayIds: overlays.map((o) => o.id),
    cityName: project.city?.name ?? null,
    countryName: null,
    ownerUsername: username,
    ownerApprovedCount: null,
    ownerRejectedCount: null,
  };
}

export function createProjectForModerationFromProject(
  project: Project,
  overlays: OverlayForModeration[],
): ProjectForModeration {
  return {
    ...project,
    tags: project.tags,
    cityName: project.city?.name ?? null,
    countryCode: project.countryCode,
    countryName: null,
    overlays,
    overlayCount: project.overlayIds.length,
  };
}
