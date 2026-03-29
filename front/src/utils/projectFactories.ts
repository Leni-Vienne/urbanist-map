// Factory functions for creating project and overlay objects
// Eliminates massive code duplication across currentLocationPanel, ContributePanel, and useAllContributions

import type {
  OverlayData,
  Project,
  ProjectForModeration,
  OverlayForModeration,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import type { ApprovalStatus } from "@shared/types";

/**
 * Create OverlayForModeration from overlay data
 */
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
    countryCode: overlayData.project?.city?.countryCode ?? null,
    countryName: null,
    replacesOverlayId: overlayData.replacesOverlayId,
    replacedByOverlayId: overlayData.replacedByOverlayId,
    imageUrl: overlayData.filename.startsWith("data:") ? overlayData.filename : undefined,
  };
}

/**
 * Create UserContributionOverlay from local (unsaved) overlay object
 * Used by useAllContributions for overlays that exist only in frontend state
 */
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
    imageUrl: overlay.imageUrl, // Preserve local image URL for thumbnail display
  };
}

type LocalProject = {
  id: string;
  name: string | null;
  description: string | null;
  ownerId: string | null;
  cityId: number | null;
  city: { name: string; countryCode: string } | null;
  lat: number | null;
  lng: number | null;
  proposalDate: Date | null;
  proposalDatePrecision?: "year" | "month" | "day" | null;
  startDate: Date | null;
  startDatePrecision?: "year" | "month" | "day" | null;
  endDate: Date | null;
  endDatePrecision?: "year" | "month" | "day" | null;
  timelineStatus?: "proposed" | "planned" | "under_construction" | "completed" | "canceled" | null;
  importSourceId?: string | null;
  externalId?: string | null;
  externalProperties?: any;
  externalLastModified?: Date | null;
  lastImportedAt?: Date | null;
  sourceUrl: string | null;
  tags?: string[] | null;
};

function buildLocalProjectShell(
  localProject: LocalProject,
  overlays: UserContributionOverlay[],
  username: string | null,
): UserContribution {
  return {
    id: localProject.id,
    name: localProject.name,
    description: localProject.description ?? null,
    status: null,
    version: 1,
    ownerId: localProject.ownerId ?? "",
    ownerUsername: username,
    ownerApprovedCount: null,
    ownerRejectedCount: null,
    cityId: localProject.cityId,
    cityName: localProject.city?.name ?? null,
    countryCode: localProject.city?.countryCode ?? null,
    countryName: null,
    lat: localProject.lat,
    lng: localProject.lng,
    city: localProject.cityId
      ? {
          id: localProject.cityId,
          name: localProject.city?.name ?? "",
          countryCode: localProject.city?.countryCode ?? "",
          nameLocal: null,
          coordinates: { x: 0, y: 0 },
          approvedProjectCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
    proposalDate: localProject.proposalDate,
    proposalDatePrecision: localProject.proposalDatePrecision ?? null,
    startDate: localProject.startDate,
    startDatePrecision: localProject.startDatePrecision ?? null,
    endDate: localProject.endDate,
    endDatePrecision: localProject.endDatePrecision ?? null,
    timelineStatus: localProject.timelineStatus ?? "proposed",
    importSourceId: localProject.importSourceId ?? null,
    externalId: localProject.externalId ?? null,
    externalProperties: localProject.externalProperties ?? null,
    externalLastModified: localProject.externalLastModified ?? null,
    lastImportedAt: localProject.lastImportedAt ?? null,
    sourceUrl: localProject.sourceUrl ?? null,
    tags: localProject.tags ?? [],
    geometry: null,
    rejectionReason: null,
    centerCoordinate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overlays,
    overlayCount: overlays.length,
  };
}

/**
 * Create UserContribution from a local (unsaved) project with a single overlay.
 * Used by useAllContributions for projects that exist only in frontend state.
 */
export function createLocalProjectContribution(
  localProject: LocalProject,
  overlay: {
    id: string;
    caption: string | null;
    filename: string;
    projectId: string | null;
    authorId: string | null;
    replacesOverlayId: string | null;
    imageUrl?: string;
  },
  username: string | null,
): UserContribution {
  const overlayData = createLocalOverlayContribution(
    overlay,
    {
      cityId: localProject.cityId,
      cityName: localProject.city?.name ?? null,
      countryCode: localProject.city?.countryCode ?? null,
      countryName: null,
    },
    username,
  );
  return buildLocalProjectShell(localProject, [overlayData], username);
}

/**
 * Create ProjectForModeration from a full Project object with pre-built overlays.
 * Used by ContributePanel for external (non-owned) selected projects.
 */
export function createProjectForModerationFromProject(
  project: Project,
  overlays: OverlayForModeration[],
): ProjectForModeration {
  return {
    ...project,
    tags: project.tags ?? null,
    cityName: project.city?.name ?? null,
    countryCode: project.city?.countryCode ?? null,
    countryName: null,
    overlays,
    overlayCount: project.overlayIds?.length ?? 0,
  };
}

/**
 * Create UserContribution from a local (unsaved) project with pre-built overlays.
 * Used when overlays have already been mapped via createLocalOverlayContribution.
 */
export function createLocalProjectContributionWithOverlays(
  localProject: LocalProject,
  overlays: UserContributionOverlay[],
  username: string | null,
): UserContribution {
  return buildLocalProjectShell(localProject, overlays, username);
}
