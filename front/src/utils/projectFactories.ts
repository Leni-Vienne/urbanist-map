// AI : Factory functions for creating project and overlay objects
// AI : Eliminates massive code duplication across currentLocationPanel, ContributePanel, and useAllContributions

import type {
  OverlayData,
  ProjectForModeration,
  OverlayForModeration,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";

import type { ApprovalStatus } from "@shared/types";

interface SelectedCity {
  id: number;
  name: string;
  countryCode?: string;
}

interface CountryInfo {
  code: string;
  name: string;
}

/**
 * AI : Create ProjectForModeration from overlay data
 * AI : Used by currentLocationPanel to build projects from city overlay cache
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
    status: (projectInfo?.status ?? "approved") as ApprovalStatus,
    ownerId: projectInfo?.ownerId ?? overlayData.authorId,
    cityId: projectInfo?.cityId ?? selectedCity.id,
    lat: projectInfo?.lat ?? overlayData.centroid.lat,
    lng: projectInfo?.lng ?? overlayData.centroid.lng,
    proposalDate: projectInfo?.proposalDate ?? null,
    startDate: projectInfo?.startDate ?? null,
    endDate: projectInfo?.endDate ?? null,
    sourceUrl: projectInfo?.sourceUrl ?? null,
    createdAt: projectInfo?.createdAt ?? overlayData.createdAt,
    updatedAt: projectInfo?.updatedAt ?? overlayData.updatedAt,
    version: projectInfo?.version ?? overlayData.version,
    countryCode: projectInfo?.city?.countryCode ?? selectedCity.countryCode ?? null,
    countryName: getCountryName(
      projectInfo?.city?.countryCode ?? selectedCity.countryCode,
      countries,
    ),
    cityName: projectInfo?.city?.name ?? selectedCity.name,
    overlays: [],
  };
}

/**
 * AI : Create OverlayForModeration from overlay data
 * AI : Used by currentLocationPanel
 */
export function createOverlayForModeration(
  overlayData: OverlayData,
  selectedCity: SelectedCity,
): OverlayForModeration {
  return {
    id: overlayData.id,
    name: overlayData.caption ?? "",
    filename: overlayData.filename,
    status: overlayData.status,
    version: overlayData.version,
    projectId: overlayData.projectId,
    updatedAt: overlayData.updatedAt,
    authorId: overlayData.authorId,
    authorUsername: undefined,
    authorReportCount: undefined,
    cityId: overlayData.project?.cityId ?? selectedCity.id,
    cityName: overlayData.project?.city?.name ?? selectedCity.name,
    countryCode: overlayData.project?.city?.countryCode ?? selectedCity.countryCode ?? null,
    countryName: null,
    replacesOverlayId: overlayData.replacesOverlayId,
    replacedByOverlayId: overlayData.replacedByOverlayId,
  };
}

/**
 * AI : Helper to get country name from country code
 */
function getCountryName(
  countryCode: string | null | undefined,
  countries: CountryInfo[],
): string | null {
  if (!countryCode) return null;
  const country = countries.find((c) => c.code === countryCode);
  return country?.name ?? null;
}

/**
 * AI : Create UserContributionOverlay from local (unsaved) overlay object
 * AI : Used by useAllContributions for overlays that exist only in frontend state
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
    cityId: number;
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
    imageUrl: overlay.imageUrl, // AI : Preserve local image URL for thumbnail display
  };
}

/**
 * AI : Create UserContribution from local (unsaved) project with overlay
 * AI : Used by useAllContributions for projects that exist only in frontend state
 */
export function createLocalProjectContribution(
  localProject: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string | null;
    cityId: number;
    city: { name: string; countryCode: string };
    lat: number | null;
    lng: number | null;
    proposalDate: Date | null;
    startDate: Date | null;
    endDate: Date | null;
    sourceUrl: string | null;
    latestUpdateOn: Date | null;
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
      id: localProject.cityId,
      name: localProject.city.name,
      countryCode: localProject.city.countryCode,
      nameLocal: null, // AI : Default for local project
      coordinates: { x: 0, y: 0 },
      approvedProjectCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    proposalDate: localProject.proposalDate,
    startDate: localProject.startDate,
    endDate: localProject.endDate,
    sourceUrl: localProject.sourceUrl ?? null,
    latestUpdateOn: localProject.latestUpdateOn ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overlays: [overlayData],
    overlayCount: 1,
  };
}
