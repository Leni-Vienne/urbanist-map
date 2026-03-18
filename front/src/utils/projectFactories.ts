// Factory functions for creating project and overlay objects
// Eliminates massive code duplication across currentLocationPanel, ContributePanel, and useAllContributions

import type {
  OverlayData,
  ProjectForModeration,
  OverlayForModeration,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";

import { getCountryName, type CountryInfo } from "@/services/map/countryData";

interface SelectedCity {
  id: number;
  name: string;
  countryCode?: string;
}

/**
 * Create ProjectForModeration from overlay data
 * Used by currentLocationPanel to build projects from city overlay cache
 */
// eslint-disable-next-line complexity
export function createProjectFromOverlayData(
  overlayData: OverlayData,
  selectedCity: SelectedCity,
  countries: CountryInfo[],
): ProjectForModeration {
  const projectInfo = overlayData.project;

  return {
    id: overlayData.projectId ?? "",
    name: projectInfo?.name ?? overlayData.projectId ?? "",
    description: projectInfo?.description ?? null,
    status: projectInfo?.status ?? "approved",
    ownerId: projectInfo?.ownerId ?? overlayData.authorId,
    cityId: projectInfo?.cityId ?? selectedCity.id,
    lat: projectInfo?.lat ?? overlayData.centroid.lat,
    lng: projectInfo?.lng ?? overlayData.centroid.lng,
    proposalDate: projectInfo?.proposalDate ?? null,
    proposalDatePrecision: projectInfo?.proposalDatePrecision ?? null,
    startDate: projectInfo?.startDate ?? null,
    startDatePrecision: projectInfo?.startDatePrecision ?? null,
    endDate: projectInfo?.endDate ?? null,
    endDatePrecision: projectInfo?.endDatePrecision ?? null,
    sourceUrl: projectInfo?.sourceUrl ?? null,
    tags: projectInfo?.tags ?? [],
    createdAt: projectInfo?.createdAt ?? overlayData.createdAt,
    updatedAt: projectInfo?.updatedAt ?? overlayData.updatedAt,
    version: projectInfo?.version ?? overlayData.version,
    countryCode: projectInfo?.city.countryCode ?? selectedCity.countryCode ?? null,
    countryName: getCountryName(
      projectInfo?.city.countryCode ?? selectedCity.countryCode,
      countries,
    ),
    cityName: projectInfo?.city.name ?? selectedCity.name,
    overlays: [],
  };
}

/**
 * Create OverlayForModeration from overlay data
 * Used by currentLocationPanel
 */
export function createOverlayForModeration(
  overlayData: OverlayData,
  selectedCity: SelectedCity,
): OverlayForModeration {
  return {
    id: overlayData.id,
    name: overlayData.caption ?? "",
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
    cityId: overlayData.project?.cityId ?? selectedCity.id,
    cityName: overlayData.project?.city.name ?? selectedCity.name,
    countryCode: overlayData.project?.city.countryCode ?? selectedCity.countryCode ?? null,
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
    imageUrl?: string;
  },
  parentProject: {
    cityId: number | null;
    cityName: string;
    countryCode: string | null;
    countryName: string | null;
  },
  username: string | null,
): UserContributionOverlay {
  return {
    id: overlay.id,
    name: overlay.caption ?? "Untitled",
    filename: overlay.filename,
    status: null,
    version: 1,
    projectId: overlay.projectId ?? "",
    authorId: overlay.authorId ?? null,
    authorUsername: username,
    authorApprovedCount: null,
    authorRejectedCount: null,
    replacesOverlayId: overlay.replacesOverlayId ?? null,
    replacedByOverlayId: null,
    updatedAt: new Date(),
    cityId: parentProject.cityId,
    cityName: parentProject.cityName,
    countryCode: parentProject.countryCode,
    countryName: parentProject.countryName,
    imageUrl: overlay.imageUrl, // Preserve local image URL for thumbnail display
  };
}

/**
 * Create UserContribution from local (unsaved) project with overlay
 * Used by useAllContributions for projects that exist only in frontend state
 */
export function createLocalProjectContribution(
  localProject: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string | null;
    cityId: number | null;
    city: { name: string; countryCode: string };
    lat: number | null;
    lng: number | null;
    proposalDate: Date | null;
    proposalDatePrecision?: "year" | "month" | "day" | null;
    startDate: Date | null;
    startDatePrecision?: "year" | "month" | "day" | null;
    endDate: Date | null;
    endDatePrecision?: "year" | "month" | "day" | null;
    sourceUrl: string | null;
    tags?: string[] | null;
  },
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
      cityName: localProject.city.name,
      countryCode: localProject.city.countryCode,
      countryName: null,
    },
    username,
  );

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
    cityName: localProject.city.name,
    countryCode: localProject.city.countryCode,
    countryName: null,
    lat: localProject.lat,
    lng: localProject.lng,
    city: {
      id: localProject.cityId ?? 0,
      name: localProject.city.name,
      countryCode: localProject.city.countryCode,
      nameLocal: null, // Default for local project
      coordinates: { x: 0, y: 0 },
      approvedProjectCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    proposalDate: localProject.proposalDate,
    proposalDatePrecision: localProject.proposalDatePrecision ?? null,
    startDate: localProject.startDate,
    startDatePrecision: localProject.startDatePrecision ?? null,
    endDate: localProject.endDate,
    endDatePrecision: localProject.endDatePrecision ?? null,
    sourceUrl: localProject.sourceUrl ?? null,
    tags: localProject.tags ?? [],
    geometry: null,
    rejectionReason: null,
    centerCoordinate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overlays: [overlayData],
    overlayCount: 1,
  };
}
