/**
 * pendingSources.ts - builds the GeoJSON sources for pending content.
 *
 * In edit/moderation modes, this module collects pending/user-owned projects and
 * overlay footprints from the session/country fetch and updates both the
 * pending-project-points source and the pending-project-shapes source. The full
 * pending set is fed once per fetch; maplibre clusters it client-side at every zoom.
 */

import { watch } from "vue";
import {
  updatePendingProjectPointsSource,
  updatePendingProjectShapesSource,
} from "@/services/map/tiles/basemap";
import type { OverlayData, Project } from "@/types/index";
import type { AppMode } from "@shared/types";
import { isValidQuad } from "@/services/overlay/transform";
import { useProjectStore } from "@/stores/projectStore";

type PendingProjectInput = {
  id: string;
  lat: number | null;
  lng: number | null;
  name: string | null;
  tags: string[] | null;
  status: string | null;
};

type ProjectShapeInput = PendingProjectInput & {
  status: string | null;
  timelineStatus?: string | null;
  geometry?: GeoJSON.GeometryCollection | null;
};

let cachedOverlaysData: OverlayData[] = [];
let cachedProjectsData: ProjectShapeInput[] = [];
let cachedMode: AppMode = "view";

/**
 * Create a GeoJSON Feature for a project point
 */
function createProjectFeature(
  project: PendingProjectInput & { lat: number; lng: number },
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [project.lng, project.lat],
    },
    properties: {
      id: project.id,
      name: project.name,
      tags: project.tags ? JSON.stringify(project.tags) : null,
      first_tag: project.tags?.[0] ?? null,
      status: project.status,
      cell_count: 1,
    },
  };
}

/**
 * Add a pending project point, unless it is non-pending, coordinate-less,
 * already added, or already represented by a standalone shape.
 */
function addProjectToMap(
  project: PendingProjectInput,
  isPending: boolean,
  standaloneShapeProjectIds: Set<string>,
  pendingProjects: Map<string, GeoJSON.Feature>,
): void {
  const { lat, lng } = project;
  if (!isPending || standaloneShapeProjectIds.has(project.id)) return;
  if (typeof lat !== "number" || typeof lng !== "number") return;
  if (pendingProjects.has(project.id)) return;

  pendingProjects.set(project.id, createProjectFeature({ ...project, lat, lng }));
}

/**
 * Collect pending polygon shapes (overlay footprints + standalone project geometries).
 * Records every project drawn as a standalone geometry in standaloneShapeProjectIds so
 * the point pass can skip it.
 */
function collectPendingShapes(
  overlaysData: OverlayData[],
  projectsData: ProjectShapeInput[],
  standaloneShapeProjectIds: Set<string>,
): GeoJSON.Feature[] {
  const shapes: GeoJSON.Feature[] = [];

  const projectStore = useProjectStore();
  for (const project of Object.values(projectStore.projects)) {
    if (!project.isModified && project.status !== null) continue;
    addProjectShape(project, standaloneShapeProjectIds, shapes);
  }

  for (const overlay of overlaysData) {
    const project = overlay.project;
    if (!project || typeof project.lat !== "number" || typeof project.lng !== "number") continue;
    if (project.geometry) standaloneShapeProjectIds.add(project.id);

    const isPending = project.status !== "approved" || overlay.status !== "approved";
    const firstCorner = overlay.baselineCorners?.[0];
    if (!isPending || !isValidQuad(overlay.baselineCorners) || !firstCorner) continue;

    shapes.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            ...overlay.baselineCorners.map((c) => [c.lng, c.lat]),
            [firstCorner.lng, firstCorner.lat],
          ],
        ],
      },
      properties: {
        id: overlay.id,
        project_id: project.id,
        sourceLayer: "overlay-footprints",
        status: overlay.status,
        name: project.name,
        timeline_status: project.timelineStatus,
        tags: project.tags ? JSON.stringify(project.tags) : null,
        first_tag: project.tags?.[0] ?? null,
      },
    });
  }

  for (const project of projectsData) {
    if (project.status === "approved") continue;
    addProjectShape(project, standaloneShapeProjectIds, shapes);
  }

  return shapes;
}

function addProjectShape(
  project: ProjectShapeInput,
  standaloneShapeProjectIds: Set<string>,
  shapes: GeoJSON.Feature[],
): void {
  if (!project.geometry || standaloneShapeProjectIds.has(project.id)) return;

  shapes.push({
    type: "Feature",
    geometry: project.geometry,
    properties: {
      id: project.id,
      sourceLayer: "project-shapes",
      status: project.status,
      name: project.name,
      timeline_status: project.timelineStatus,
      tags: project.tags ? JSON.stringify(project.tags) : null,
      first_tag: project.tags?.[0] ?? null,
    },
  });
  standaloneShapeProjectIds.add(project.id);
}

function renderPendingProjectSources(
  overlaysData: OverlayData[],
  projectsData: ProjectShapeInput[],
  mode: AppMode,
): void {
  if (mode === "view") {
    updatePendingProjectPointsSource({ type: "FeatureCollection", features: [] });
    updatePendingProjectShapesSource({ type: "FeatureCollection", features: [] });
    return;
  }

  const standaloneShapeProjectIds = new Set<string>();
  const pendingShapes = collectPendingShapes(overlaysData, projectsData, standaloneShapeProjectIds);
  const pendingPoints = collectPendingPoints(overlaysData, projectsData, standaloneShapeProjectIds);

  updatePendingProjectPointsSource({
    type: "FeatureCollection",
    features: [...pendingPoints.values()],
  });
  updatePendingProjectShapesSource({ type: "FeatureCollection", features: pendingShapes });
}

/**
 * Collect pending project points in priority order: locally modified projects win over
 * overlay-derived projects, then shape-derived.
 * Dedup and standalone-shape skipping are handled in addProjectToMap.
 */
function collectPendingPoints(
  overlaysData: OverlayData[],
  projectsData: ProjectShapeInput[],
  standaloneShapeProjectIds: Set<string>,
): Map<string, GeoJSON.Feature> {
  const pendingProjects = new Map<string, GeoJSON.Feature>();

  const projectStore = useProjectStore();
  for (const lp of Object.values(projectStore.projects)) {
    if (lp.isModified || lp.status === null) {
      addProjectToMap(lp, true, standaloneShapeProjectIds, pendingProjects);
    }
  }

  for (const overlay of overlaysData) {
    const project = overlay.project;
    if (!project) continue;
    const isPending = project.status !== "approved" || overlay.status !== "approved";
    addProjectToMap(project, isPending, standaloneShapeProjectIds, pendingProjects);
  }

  for (const project of projectsData) {
    addProjectToMap(
      project,
      project.status !== "approved",
      standaloneShapeProjectIds,
      pendingProjects,
    );
  }

  return pendingProjects;
}

/**
 * Build the pending points/shapes sources from the full session/country pending set.
 * Called once per fetch in edit/moderation modes (not on moveend); the cluster source
 * then persists across pans and zooms.
 */
export function mergeProjectPointsForMode(
  overlaysData: OverlayData[],
  projectsData: ProjectShapeInput[],
  mode: AppMode,
): void {
  cachedOverlaysData = overlaysData;
  cachedProjectsData = projectsData;
  cachedMode = mode;
  renderPendingProjectSources(overlaysData, projectsData, mode);
}

function refreshPendingProjectSources(): void {
  renderPendingProjectSources(cachedOverlaysData, cachedProjectsData, cachedMode);
}

function localProjectSourceKey(project: Project): string {
  return JSON.stringify({
    id: project.id,
    status: project.status,
    name: project.name,
    tags: project.tags,
    timelineStatus: project.timelineStatus,
    geometry: project.geometry,
    lat: project.lat,
    lng: project.lng,
  });
}

export function watchPendingProjectSources(): () => void {
  const projectStore = useProjectStore();
  return watch(
    () =>
      Object.values(projectStore.projects)
        .filter((project) => project.isModified || project.status === null)
        .map(localProjectSourceKey)
        .toSorted()
        .join("\u0000"),
    refreshPendingProjectSources,
  );
}
