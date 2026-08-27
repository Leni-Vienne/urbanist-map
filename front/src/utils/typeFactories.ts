// Factory functions for creating type instances to reduce duplication
import type {
  Project,
  ProjectDetailFields,
  ProjectSummary,
  LocalProject,
  HydratedProject,
  OverlayObject,
  LatLng,
} from "@/types/index";
import { v4 as uuidv4 } from "uuid";
import { buildImageUrl } from "@/utils/imageUrl";

export type LocalProjectInput = Partial<Omit<ProjectSummary, "id" | "status">> & {
  id?: string;
};

export type ProjectWire = Omit<ProjectSummary, "tags"> & {
  tags: string[] | null;
};

type HydratedProjectWire = ProjectWire & ProjectDetailFields;

// Rename a complete backend overlay's `corners` to the frontend domain baseline fields.
export function overlayWireToData<T extends { corners: LatLng[]; caption?: string | null }>(
  wire: T,
): Omit<T, "corners"> & {
  baselineCorners: T["corners"];
  baselineCaption: string | null;
} {
  const { corners, ...rest } = wire;
  return {
    ...rest,
    baselineCorners: corners,
    baselineCaption: rest.caption ?? null,
  };
}

export function projectFromWire(data: ProjectWire): ProjectSummary {
  return {
    ...data,
    tags: data.tags ?? [],
  };
}

export function hydratedProjectFromWire(data: HydratedProjectWire): HydratedProject {
  return {
    ...data,
    tags: data.tags ?? [],
  };
}

// Create a browser-local draft. Defaults belong here because no backend row exists yet.
// eslint-disable-next-line complexity
export function createLocalProject(data: LocalProjectInput): LocalProject {
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
    status: null,
    timelineStatus: data.timelineStatus ?? "proposed",
    importSourceId: data.importSourceId ?? null,
    externalId: data.externalId ?? null,
    externalProperties: data.externalProperties ?? null,
    externalLastModified: data.externalLastModified ?? null,
    importSource: data.importSource ?? null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    geometry: data.geometry ?? null,
    geometrySizeM: data.geometrySizeM ?? null,
    tags: data.tags ?? [],
    countryCode: data.countryCode ?? "",
    ownerUsername: data.ownerUsername,
  };
}

export function hasProjectDetailFields(project: Project): project is HydratedProject {
  return (
    project.status !== null &&
    project.slug !== undefined &&
    project.render !== undefined &&
    project.ownerUsername !== undefined &&
    project.boundaryPath !== undefined
  );
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
    positionState: data.positionState ?? (data.hasPendingChanges ? "suggested" : "baseline"),
  };
}
