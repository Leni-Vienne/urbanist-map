// Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData, UserContribution } from "@/types/index";
import type { RouterOutput } from "@/client";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";

// Type definition for project data returned by the backend
export type CityProject = RouterOutput["project"]["getCityProjects"][number];
export type StandaloneProject = CityProject | Project;

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
    cityId: data.cityId ?? null, // Now nullable for imported projects
    status: data.status ?? null,
    rejectionReason: data.rejectionReason ?? null, // Moderator-selected rejection reason
    // Timeline status - project lifecycle stage
    timelineStatus: data.timelineStatus ?? "proposed",
    // Import source tracking
    importSourceId: data.importSourceId ?? null,
    externalId: data.externalId ?? null,
    externalProperties: data.externalProperties ?? null,
    externalLastModified: data.externalLastModified ?? null,
    lastImportedAt: data.lastImportedAt ?? null,
    importSource: data.importSource ?? null,
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
    geometrySizeM: data.geometrySizeM ?? null,
    tags: data.tags ?? [],
    countryCode: data.countryCode ?? "",
    detachedAt: data.detachedAt ?? null,
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
    city: contribution.cityId
      ? {
          id: contribution.cityId,
          name: contribution.cityName ?? contribution.city?.name ?? "",
          nameLocal: contribution.city?.nameLocal ?? null,
          countryCode: contribution.countryCode ?? contribution.city?.countryCode ?? "XX",
          coordinates: { x: contribution.lng ?? 0, y: contribution.lat ?? 0 },
          approvedProjectCount: 0,
          createdAt: contribution.city?.createdAt ?? new Date(),
          updatedAt: contribution.city?.updatedAt ?? new Date(),
        }
      : undefined,
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
