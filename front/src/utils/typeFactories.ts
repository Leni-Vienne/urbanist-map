// AI : Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData, NearbyProject } from "@/types/index";
import type { RouterOutput } from "@/client";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";

// AI : Type definition for project data returned by the backend
export type CityProject = RouterOutput["project"]["getCityProjects"][number];
export type StandaloneProject = CityProject | Project;

/**
 * AI : Helper to safely convert StandaloneProject to Partial<Project>
 * AI : Maps fields common to both CityProject (backend) and Project (frontend)
 */
export function toProjectPartial(project: StandaloneProject): Partial<Project> {
  const partial: Partial<Project> = {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status, // Both types share ApprovalStatus
    ownerId: project.ownerId,
    cityId: project.cityId,

    // AI : Map backend specific date naming if needed, or common fields
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,

    // AI : Map spatial fields which are present in DBProject and Project
    lat: project.lat,
    lng: project.lng,

    // AI : safe access for optional/nullable fields
    sourceUrl: project.sourceUrl ?? null,
    proposalDate: project.proposalDate ?? null,
    startDate: project.startDate ?? null,
    endDate: project.endDate ?? null,
    latestUpdateOn: project.latestUpdateOn ?? null,
  };

  // AI : Check for optional fields that might not exist on all project types (e.g. CityProject vs Project)
  if ("centerCoordinate" in project) {
    partial.centerCoordinate = project.centerCoordinate;
  }

  if ("version" in project) {
    partial.version = project.version;
  }

  // AI : Check for optional fields that might not exist on all project types (e.g. CityProject vs Project)
  if ("rejectionReason" in project) {
    partial.rejectionReason = project.rejectionReason;
  }

  // AI : Check if 'city' object is present (it is in Project, but dependent on relation in CityProject)
  if ("city" in project) {
    partial.city = project.city;
  }

  return partial;
}

/**
 * AI : Create a new Project instance with defaults
 */
export function createProjectObject(data: Partial<Project> = {}): Project {
  const id = data.id ?? uuidv4();

  return {
    id,
    version: data.version ?? 1,
    name: data.name ?? "",
    description: data.description ?? null,
    sourceUrl: data.sourceUrl ?? null,
    proposalDate: data.proposalDate ?? null,
    proposalDatePrecision: data.proposalDatePrecision ?? null,
    startDate: data.startDate ?? null,
    startDatePrecision: data.startDatePrecision ?? null,
    endDate: data.endDate ?? null,
    endDatePrecision: data.endDatePrecision ?? null,
    latestUpdateOn: data.latestUpdateOn ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ownerId: data.ownerId ?? "",
    cityId: data.cityId ?? 0,
    status: data.status ?? null,
    rejectionReason: data.rejectionReason ?? null, // AI : Moderator-selected rejection reason
    // AI : Center coordinate fields - all projects now have center coordinates
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    centerCoordinate: data.centerCoordinate ?? null,
    // AI : Computed fields
    city: data.city ?? {
      id: 0,
      name: "",
      nameLocal: null,
      countryCode: "",
      coordinates: { x: 0, y: 0 },
      approvedProjectCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    overlayIds: data.overlayIds ?? [],
    // AI : Map coordinates for display (computed from lat/lng)
    mapCoordinates: data.mapCoordinates ?? null,
    ...data,
  };
}

/**
 * AI : Convert NearbyProject API data to local Project format
 */
export function createProjectObjectFromAPI(nearbyProject: NearbyProject): Project {
  return createProjectObject({
    id: nearbyProject.id,
    version: nearbyProject.version,
    name: nearbyProject.name,
    description: nearbyProject.description,
    sourceUrl: nearbyProject.sourceUrl ?? null,
    proposalDate: nearbyProject.proposalDate ?? null,
    startDate: nearbyProject.startDate ?? null,
    endDate: nearbyProject.endDate ?? null,
    latestUpdateOn: nearbyProject.latestUpdateOn ?? null,
    createdAt: nearbyProject.createdAt,
    updatedAt: nearbyProject.updatedAt,
    ownerId: nearbyProject.ownerId,
    cityId: nearbyProject.cityId,
    status: nearbyProject.status,
    city: nearbyProject.city,
    overlayIds: [],
  });
}

/**
 * AI : Create a new OverlayObject instance with defaults
 */
export function createOverlayObject(data: Partial<OverlayObject> = {}): OverlayObject {
  const id = data.id ?? uuidv4();
  // AI : Preserve null status for local overlays (not yet submitted to backend)
  // AI : Only default to "pending" if status is undefined, NOT if it's null
  const status = data.status === undefined ? "pending" : data.status;
  // AI : Pending overlays are stored locally, not in R2 - force backend URL for them
  // AI : Local overlays (status === null) also use local storage
  const isPending = status === "pending" || status === null;

  return {
    id,
    version: data.version ?? 1,
    filename: data.filename ?? "",
    caption: data.caption ?? null,
    status,
    authorId: data.authorId ?? "",
    projectId: data.projectId ?? null,
    replacesOverlayId: data.replacesOverlayId ?? null,
    replacedByOverlayId: data.replacedByOverlayId ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    centroid: data.centroid ?? { lat: 0, lng: 0 },
    corners: data.corners ?? [],
    imageUrl: data.imageUrl ?? buildImageUrl(data.filename ?? "", isPending),
    isModified: data.isModified ?? false,
    overlay: data.overlay ?? null,
    marker: data.marker ?? null,
    history: data.history ?? [],
    redoStack: data.redoStack ?? [],
    project: data.project ?? null,
    ...data,
  };
}

/**
 * AI : Convert OverlayData from backend to OverlayObject with UI state
 */
export function createOverlayFromCDN(overlayData: OverlayData): OverlayObject {
  const isDataUrl = overlayData.filename.startsWith("data:");
  // AI : Pending overlays are stored locally, not in R2 - force backend URL for them
  const isPending = overlayData.status === "pending";
  const imageUrl = isDataUrl
    ? overlayData.filename
    : buildImageUrl(overlayData.filename, isPending);

  return createOverlayObject({
    ...overlayData,
    imageUrl,
    createdAt: new Date(overlayData.createdAt),
    updatedAt: new Date(overlayData.updatedAt),
  });
}

/**
 * AI : Convert OverlayObject to OverlayData format (strips UI state for caching)
 */
export function convertOverlayToData(overlayObject: OverlayObject): OverlayData {
  // AI : Calculate centroid from corners
  const centroid = calculateCentroidFromCorners(overlayObject.corners) ?? { lat: 0, lng: 0 };

  return {
    id: overlayObject.id,
    version: overlayObject.version,
    filename: overlayObject.imageUrl.startsWith("data:")
      ? overlayObject.imageUrl
      : overlayObject.filename,
    caption: overlayObject.caption,
    status: overlayObject.status,
    projectId: overlayObject.projectId,
    authorId: overlayObject.authorId,
    replacesOverlayId: overlayObject.replacesOverlayId,
    replacedByOverlayId: overlayObject.replacedByOverlayId,
    project: null,
    centroid,
    corners: overlayObject.corners,
    suggestedCorners: overlayObject.suggestedCorners, // AI : Pending position if change requests exist
    distance: 0,
    createdAt: overlayObject.createdAt,
    updatedAt: overlayObject.updatedAt,
    isModified: overlayObject.isModified,
    hasPendingChanges: overlayObject.hasPendingChanges,
  };
}

// AI : buildImageUrl imported from utils.ts
