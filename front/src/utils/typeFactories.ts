// Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData, UserContribution } from "@/types/index";
import type { RouterOutput } from "@/client";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";

// Type definition for project data returned by the backend
export type CityProject = RouterOutput["project"]["getCityProjects"][number];
export type StandaloneProject = CityProject | Project;

/**
 * Helper to safely convert StandaloneProject to Partial<Project>
 * Maps fields common to both CityProject (backend) and Project (frontend)
 */
export function toProjectPartial(project: StandaloneProject): Partial<Project> {
  const partial: Partial<Project> = {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status, // Both types share ApprovalStatus
    ownerId: project.ownerId,
    cityId: project.cityId,

    // Map backend specific date naming if needed, or common fields
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,

    // Map spatial fields which are present in DBProject and Project
    lat: project.lat,
    lng: project.lng,

    // safe access for optional/nullable fields
    sourceUrl: project.sourceUrl ?? null,
    proposalDate: project.proposalDate ?? null,
    proposalDatePrecision: project.proposalDatePrecision ?? null,
    startDate: project.startDate ?? null,
    startDatePrecision: project.startDatePrecision ?? null,
    endDate: project.endDate ?? null,
    endDatePrecision: project.endDatePrecision ?? null,
  };

  // Check for optional fields that might not exist on all project types (e.g. CityProject vs Project)
  if ("centerCoordinate" in project) {
    partial.centerCoordinate = project.centerCoordinate;
  }

  if ("version" in project) {
    partial.version = project.version;
  }

  // Check for optional fields that might not exist on all project types (e.g. CityProject vs Project)
  if ("rejectionReason" in project) {
    partial.rejectionReason = project.rejectionReason;
  }

  // Check if 'city' object is present (it is in Project, but dependent on relation in CityProject)
  if ("city" in project) {
    partial.city = project.city;
  }

  if ("geometry" in project) {
    partial.geometry = (project as { geometry: GeoJSON.GeometryCollection | null }).geometry;
  }

  if ("tags" in project) {
    partial.tags = project.tags ?? [];
  }

  return partial;
}

// Accepts any subset of Project fields, with null allowed for any field.
// All coercion to non-null defaults happens inside the factory body.
type ProjectInput = { [K in keyof Project]?: Project[K] | null };

/**
 * Create a new Project instance with defaults
 */
export function createProjectObject(data: ProjectInput = {}): Project {
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
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ownerId: data.ownerId ?? "",
    cityId: data.cityId ?? 0,
    status: data.status ?? null,
    rejectionReason: data.rejectionReason ?? null, // Moderator-selected rejection reason
    // Center coordinate fields - all projects now have center coordinates
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    centerCoordinate: data.centerCoordinate ?? null,
    // Computed fields
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
    geometry: data.geometry ?? null,
    tags: data.tags ?? [],
  };
}

export function createProjectFromUserContribution(contribution: UserContribution): Project {
  return createProjectObject({
    id: contribution.id,
    name: contribution.name,
    description: contribution.description ?? null,
    proposalDate: contribution.proposalDate ?? null,
    proposalDatePrecision: contribution.proposalDatePrecision ?? null,
    startDate: contribution.startDate ?? null,
    startDatePrecision: contribution.startDatePrecision ?? null,
    endDate: contribution.endDate ?? null,
    endDatePrecision: contribution.endDatePrecision ?? null,
    sourceUrl: contribution.sourceUrl ?? null,
    lat: contribution.lat,
    lng: contribution.lng,
    cityId: contribution.cityId,
    city: {
      id: contribution.cityId,
      name: contribution.cityName ?? contribution.city.name,
      nameLocal: contribution.city.nameLocal ?? null,
      countryCode: contribution.countryCode ?? contribution.city.countryCode ?? "XX",
      coordinates: { x: contribution.lng ?? 0, y: contribution.lat ?? 0 },
      approvedProjectCount: 0,
      createdAt: contribution.city.createdAt,
      updatedAt: contribution.city.updatedAt,
    },
    status: contribution.status,
    rejectionReason: null,
    overlayIds: contribution.overlays.map((overlay) => overlay.id),
    createdAt: contribution.createdAt,
    updatedAt: contribution.updatedAt,
    ownerId: contribution.ownerId ?? null,
    centerCoordinate: {
      x: contribution.lng ?? 0,
      y: contribution.lat ?? 0,
    },
    version: contribution.version,
    geometry: contribution.geometry ?? null,
    tags: contribution.tags,
  });
}

/**
 * Create a new OverlayObject instance with defaults
 */
export function createOverlayObject(data: Partial<OverlayObject> = {}): OverlayObject {
  const id = data.id ?? uuidv4();
  // Preserve null status for local overlays (not yet submitted to backend)
  // Only default to "pending" if status is undefined, NOT if it's null
  const status = data.status === undefined ? "pending" : data.status;
  // Pending overlays are stored locally, not in R2 - force backend URL for them
  // Local overlays (status === null) also use local storage
  const isPending = status === "pending" || status === null;

  const filename = data.filename ?? "";
  const isDataUrl = filename.startsWith("data:");
  const imageUrl = data.imageUrl ?? (isDataUrl ? filename : buildImageUrl(filename, isPending));

  return {
    id,
    version: data.version ?? 1,
    filename,
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
    imageUrl,
    isModified: data.isModified ?? false,
    history: data.history ?? [],
    redoStack: data.redoStack ?? [],
    project: data.project ?? null,
    suggestedCorners: data.suggestedCorners ?? undefined,
    hasPendingChanges: data.hasPendingChanges ?? undefined,
    isTooBig: data.isTooBig ?? undefined,
  };
}

/**
 * Convert OverlayObject to OverlayData format (strips UI state for caching)
 */
export function convertOverlayToData(overlayObject: OverlayObject): OverlayData {
  // Calculate centroid from corners
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
    suggestedCorners: overlayObject.suggestedCorners, // Pending position if change requests exist
    distance: 0,
    createdAt: overlayObject.createdAt,
    updatedAt: overlayObject.updatedAt,
    isModified: overlayObject.isModified,
    hasPendingChanges: overlayObject.hasPendingChanges,
  };
}
