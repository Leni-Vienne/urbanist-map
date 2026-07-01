// Factory functions for creating type instances to reduce duplication
import type { Project, OverlayObject, OverlayData, Overlay } from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";

// Accepts any subset of Project fields, with null allowed for any field.
// All coercion to non-null defaults happens inside the factory body.
type ProjectInput = { [K in keyof Project]?: Project[K] | null };

/**
 * Create a new Project instance with defaults
 */
// eslint-disable-next-line complexity
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
    ownerUsername: data.ownerUsername ?? null,
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
    adminBoundaryId: data.adminBoundaryId ?? null,
    overlayIds: data.overlayIds ?? [],
    geometry: data.geometry ?? null,
    geometrySizeM: data.geometrySizeM ?? null,
    tags: data.tags ?? [],
    countryCode: data.countryCode ?? "",
    slug: data.slug ?? null,
    detachedAt: data.detachedAt ?? null,
    importLockedAt: data.importLockedAt ?? null,
    // Left undefined when the source didn't carry it (e.g. viewport payload), so the detail panel knows
    // to hydrate it via getById. null only after getById confirms there is no render.
    render: data.render,
    boundaryPath: data.boundaryPath,
  };
}

/**
 * Create a new OverlayObject instance with defaults
 */
// eslint-disable-next-line complexity
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

/**
 * Build the list-metadata Overlay shape for a local (unsubmitted) overlay or staged render, from a
 * loose overlay literal plus its parent project's country.
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
    countryCode: string | null;
    countryName?: string | null;
  },
  username: string | null,
  kind: Overlay["kind"] = "map",
): Overlay {
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

// A staged render (still only in stagedRenderStore) as a pending render overlay entry, so it appears
// on its parent contribution in My Contributions the same way a submitted render does.
export function createStagedRenderOverlay(
  projectId: string,
  previewUrl: string,
  parentProject: { countryCode: string | null; countryName?: string | null },
  username: string | null,
  authorId: string | null,
): Overlay {
  const renderId = `staged-render-${projectId}`;
  return createLocalOverlayContribution(
    {
      id: renderId,
      caption: null,
      filename: `${renderId}.webp`,
      projectId,
      authorId,
      replacesOverlayId: null,
      status: null,
      imageUrl: previewUrl,
    },
    parentProject,
    username,
    "render",
  );
}
