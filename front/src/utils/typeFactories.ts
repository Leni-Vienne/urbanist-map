// Factory functions for creating type instances to reduce duplication
import type { Project, ProjectDetailFields, OverlayObject, Overlay, LatLng } from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";

// Accepts any subset of Project fields, with null allowed for any field.
// All coercion to non-null defaults happens inside the factory body.
type ProjectInput = { [K in keyof Project]?: Project[K] | null };

// Rename a wire overlay's `corners` to the frontend domain field `baselineCorners`, and snapshot
// the wire `caption` into `baselineCaption` (the approved caption, never overwritten by edits).
// The single translation from the tRPC wire shape to OverlayData.
export function overlayWireToData<T extends { corners: LatLng[]; caption?: string | null }>(
  wire: T,
): Omit<T, "corners"> & {
  baselineCorners: T["corners"];
  baselineCaption: string | null;
  source: "bbox";
} {
  const { corners, ...rest } = wire;
  return {
    ...rest,
    baselineCorners: corners,
    baselineCaption: rest.caption ?? null,
    source: "bbox",
  };
}

/**
 * Create a new Project instance with defaults
 */
// eslint-disable-next-line complexity
export function createProjectObject(data: ProjectInput): Project {
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
    status: data.status ?? null,
    timelineStatus: data.timelineStatus ?? "proposed",
    importSourceId: data.importSourceId ?? null,
    externalId: data.externalId ?? null,
    externalProperties: data.externalProperties ?? null,
    externalLastModified: data.externalLastModified ?? null,
    importSource: data.importSource ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    overlayIds: data.overlayIds ?? [],
    geometry: data.geometry ?? null,
    geometrySizeM: data.geometrySizeM ?? null,
    tags: data.tags ?? [],
    countryCode: data.countryCode ?? "",
    slug: data.slug,
    // Detail fields remain omitted until their source has supplied them.
    render: data.render,
    boundaryPath: data.boundaryPath,
    ownerUsername: data.ownerUsername,
  };
}

export function getProjectDetailFields(project: Project): ProjectDetailFields {
  return {
    slug: project.slug ?? null,
    render: project.render ?? null,
    ownerUsername: project.ownerUsername ?? null,
    boundaryPath: project.boundaryPath ?? null,
  };
}

/**
 * Create a new OverlayObject instance with defaults
 */
// eslint-disable-next-line complexity
export function createOverlayObject(data: Partial<OverlayObject>): OverlayObject {
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
    baselineCorners: data.baselineCorners ?? null,
    baselineCaption: data.baselineCaption ?? data.caption ?? null,
    imageUrl,
    history: data.history ?? [],
    redoStack: data.redoStack ?? [],
    suggestedCorners: data.suggestedCorners ?? undefined,
    suggestedCaption: data.suggestedCaption ?? undefined,
    hasPendingChanges: data.hasPendingChanges ?? undefined,
    isTooBig: data.isTooBig ?? undefined,
    source: data.source ?? "local",
    positionState: data.positionState ?? (data.hasPendingChanges ? "suggested" : "baseline"),
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

// A staged render (still only in stagedRenderState) as a pending render overlay entry, so it appears
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
