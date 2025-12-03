// AI : Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData } from "@types";
import type { NearbyProject } from "../types/api";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@utils/imageUrl";
import { calculateCentroidFromCorners } from "../../../back/src/shared/validation";

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
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    latestUpdateOn: data.latestUpdateOn ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ownerId: data.ownerId ?? "",
    cityId: data.cityId ?? "",
    status: data.status ?? null,
    // AI : Center coordinate fields - all projects now have center coordinates
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    centerCoordinate: data.centerCoordinate ?? null,
    // AI : Computed fields
    city: data.city ?? {
      id: "",
      name: "",
      countryCode: "",
      coordinates: { x: 0, y: 0 },
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
    version: nearbyProject.version ?? 1,
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
    status: nearbyProject.status ?? "approved",
    city: nearbyProject.city,
    overlayIds: [],
  });
}

/**
 * AI : Create a new OverlayObject instance with defaults
 */
export function createOverlayObject(data: Partial<OverlayObject> = {}): OverlayObject {
  const id = data.id ?? uuidv4();

  return {
    id,
    version: data.version ?? 1,
    filename: data.filename ?? "",
    caption: data.caption ?? null,
    status: data.status ?? "pending",
    authorId: data.authorId ?? "",
    projectId: data.projectId ?? null,
    replacesOverlayId: data.replacesOverlayId ?? null,
    replacedByOverlayId: data.replacedByOverlayId ?? null,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    centroid: data.centroid ?? { lat: 0, lng: 0 },
    corners: data.corners ?? [],
    imageUrl: data.imageUrl ?? buildImageUrl(data.filename ?? ""),
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
  const imageUrl = isDataUrl ? overlayData.filename : buildImageUrl(overlayData.filename);

  return createOverlayObject({
    ...overlayData,
    imageUrl,
    createdAt: new Date(overlayData.createdAt),
    updatedAt: new Date(overlayData.updatedAt ?? overlayData.createdAt),
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
    filename: overlayObject.imageUrl,
    caption: overlayObject.caption,
    status: overlayObject.status,
    projectId: overlayObject.projectId,
    authorId: overlayObject.authorId,
    replacesOverlayId: overlayObject.replacesOverlayId,
    replacedByOverlayId: overlayObject.replacedByOverlayId,
    project: null,
    centroid,
    corners: overlayObject.corners ?? [],
    suggestedCorners: overlayObject.suggestedCorners, // AI : Pending position if change requests exist
    distance: 0,
    createdAt: overlayObject.createdAt,
    updatedAt: overlayObject.updatedAt,
    isModified: overlayObject.isModified,
    hasPendingChanges: overlayObject.hasPendingChanges,
  };
}

// AI : buildImageUrl imported from utils.ts
