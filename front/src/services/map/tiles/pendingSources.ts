/**
 * pendingSources.ts - builds the GeoJSON sources for pending content.
 *
 * In edit/moderation modes, this module collects pending/user-owned projects and
 * overlay footprints from the bbox tRPC fetch and updates both the
 * pending-project-points source and the pending-project-shapes source.
 */

import {
  updatePendingProjectPointsSource,
  updatePendingProjectShapesSource,
} from "@/services/map/tiles/basemap";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";
import { isValidQuad } from "@/services/overlay/transform";
import { trpc } from "@/client";
import { useAuthStore } from "@/stores/authStore";
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
  status: string;
  timelineStatus?: string | null;
  geometry?: GeoJSON.GeometryCollection | null;
};

let globalPendingPoints: PendingProjectInput[] = [];

/**
 * Fetch lightweight pending points globally for the current mode.
 * Call this when switching to edit or moderation mode.
 */
export async function updateGlobalPendingPoints(mode: AppMode): Promise<void> {
  if (mode === "view") {
    globalPendingPoints = [];
    return;
  }
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) {
    globalPendingPoints = [];
    return;
  }
  try {
    globalPendingPoints = await trpc.viewport.getGlobalPendingPoints.query({ mode });
  } catch (error) {
    console.error("Failed to fetch global pending points", error);
    globalPendingPoints = [];
  }
}

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
    if (project.status === "approved" || !project.geometry) continue;

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

  return shapes;
}

/**
 * Collect pending project points in priority order: locally modified projects win over
 * overlay-derived projects, then shape-derived, then global lightweight points.
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

  for (const project of globalPendingPoints) {
    addProjectToMap(project, true, standaloneShapeProjectIds, pendingProjects);
  }

  return pendingProjects;
}

/**
 * Merge pending projects from bbox fetch into the geojson source.
 * Call after each viewport fetch in edit/moderation modes.
 */
export function mergeProjectPointsForMode(
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
