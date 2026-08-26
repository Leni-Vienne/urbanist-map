import { watch } from "vue";
import {
  updatePendingProjectPointsSource,
  updatePendingProjectShapesSource,
} from "@/services/map/tiles/basemap";
import type { OverlayData, Project } from "@/types/index";
import { isValidQuad } from "@/services/overlay/transform";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { getMapSessionSnapshot, type MapSessionMode } from "@/services/map/mapSessionState";
import { activeFilters, matchesProjectFilters } from "@/services/core/filters";

function matchesPendingProjectFilters(project: Project, imageProjectIds: Set<string>): boolean {
  const lastModified = project.externalLastModified ?? project.updatedAt;
  return matchesProjectFilters({
    tags: project.tags,
    timelineStatus: project.timelineStatus,
    name: project.name,
    geometrySizeM: project.geometrySizeM,
    lastModifiedMs: lastModified.getTime(),
    hasImage:
      project.hasImage === true ||
      imageProjectIds.has(project.id) ||
      (project.render !== null && project.render !== undefined),
  });
}

function collectLocalProjectShapes(
  mode: MapSessionMode,
  standaloneShapeProjectIds: Set<string>,
  shapes: GeoJSON.Feature[],
  imageProjectIds: Set<string>,
): void {
  if (mode !== "edit") return;
  const projectStore = useProjectStore();
  for (const project of Object.values(projectStore.projects)) {
    if (!project.isModified && project.status !== null) continue;
    if (!matchesPendingProjectFilters(project, imageProjectIds)) continue;
    const originalGeometry = project.isModified
      ? projectStore.getOriginalProject(project.id)?.geometry
      : null;
    if (originalGeometry && JSON.stringify(originalGeometry) !== JSON.stringify(project.geometry)) {
      shapes.push(
        createProjectShapeFeature(project, originalGeometry, {
          color: "#9ca3af",
          opacity: 0.4,
          fillOpacity: 0.1,
          hoverOpacity: 0.4,
        }),
      );
    }
    addProjectShape(project, standaloneShapeProjectIds, shapes);
  }
}

function collectLocalProjectPoints(
  mode: MapSessionMode,
  standaloneShapeProjectIds: Set<string>,
  pendingProjects: Map<string, GeoJSON.Feature>,
  imageProjectIds: Set<string>,
): void {
  if (mode !== "edit") return;
  for (const project of Object.values(useProjectStore().projects)) {
    if (
      (project.isModified || project.status === null) &&
      matchesPendingProjectFilters(project, imageProjectIds)
    ) {
      addProjectToMap(project, true, standaloneShapeProjectIds, pendingProjects);
    }
  }
}

/**
 * Create a GeoJSON Feature for a project point
 */
function createProjectFeature(project: Project & { lat: number; lng: number }): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [project.lng, project.lat],
    },
    properties: {
      id: project.id,
      name: project.name,
      tags: JSON.stringify(project.tags),
      first_tag: project.tags[0] ?? null,
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
  project: Project,
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
  projectsData: Project[],
  standaloneShapeProjectIds: Set<string>,
  mode: MapSessionMode,
  imageProjectIds: Set<string>,
): GeoJSON.Feature[] {
  const shapes: GeoJSON.Feature[] = [];

  const projectStore = useProjectStore();
  collectLocalProjectShapes(mode, standaloneShapeProjectIds, shapes, imageProjectIds);

  for (const overlay of overlaysData) {
    const project = overlay.projectId
      ? projectStore.getMapProjectById(overlay.projectId, mode)
      : null;
    if (!project || typeof project.lat !== "number" || typeof project.lng !== "number") continue;
    if (!matchesPendingProjectFilters(project, imageProjectIds)) continue;
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
        tags: JSON.stringify(project.tags),
        first_tag: project.tags[0] ?? null,
      },
    });
  }

  for (const project of projectsData) {
    if (project.status === "approved") continue;
    if (!matchesPendingProjectFilters(project, imageProjectIds)) continue;
    addProjectShape(project, standaloneShapeProjectIds, shapes);
  }

  return shapes;
}

function addProjectShape(
  project: Project,
  standaloneShapeProjectIds: Set<string>,
  shapes: GeoJSON.Feature[],
): void {
  if (!project.geometry || standaloneShapeProjectIds.has(project.id)) return;

  shapes.push(createProjectShapeFeature(project, project.geometry));
  standaloneShapeProjectIds.add(project.id);
}

function createProjectShapeFeature(
  project: Project,
  geometry: GeoJSON.GeometryCollection,
  style: Record<string, string | number> = {},
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry,
    properties: {
      id: project.id,
      sourceLayer: "project-shapes",
      status: project.status,
      name: project.name,
      timeline_status: project.timelineStatus,
      tags: JSON.stringify(project.tags),
      first_tag: project.tags[0] ?? null,
      ...style,
    },
  };
}

function renderPendingProjectSources(
  overlaysData: OverlayData[],
  projectsData: Project[],
  mode: MapSessionMode,
  imageProjectIds: Set<string>,
): void {
  const standaloneShapeProjectIds = new Set<string>();
  const pendingShapes = collectPendingShapes(
    overlaysData,
    projectsData,
    standaloneShapeProjectIds,
    mode,
    imageProjectIds,
  );
  const pendingPoints = collectPendingPoints(
    overlaysData,
    projectsData,
    standaloneShapeProjectIds,
    mode,
    imageProjectIds,
  );

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
  projectsData: Project[],
  standaloneShapeProjectIds: Set<string>,
  mode: MapSessionMode,
  imageProjectIds: Set<string>,
): Map<string, GeoJSON.Feature> {
  const pendingProjects = new Map<string, GeoJSON.Feature>();

  const projectStore = useProjectStore();
  collectLocalProjectPoints(mode, standaloneShapeProjectIds, pendingProjects, imageProjectIds);

  for (const overlay of overlaysData) {
    const project = overlay.projectId
      ? projectStore.getMapProjectById(overlay.projectId, mode)
      : null;
    if (!project) continue;
    if (!matchesPendingProjectFilters(project, imageProjectIds)) continue;
    const isPending = project.status !== "approved" || overlay.status !== "approved";
    addProjectToMap(project, isPending, standaloneShapeProjectIds, pendingProjects);
  }

  for (const project of projectsData) {
    if (!matchesPendingProjectFilters(project, imageProjectIds)) continue;
    addProjectToMap(
      project,
      project.status !== "approved",
      standaloneShapeProjectIds,
      pendingProjects,
    );
  }

  return pendingProjects;
}

export function renderMapSessionPendingSources(): void {
  const session = getMapSessionSnapshot();
  if (!session || session.mode !== useMapStore().mode) {
    updatePendingProjectPointsSource({ type: "FeatureCollection", features: [] });
    updatePendingProjectShapesSource({ type: "FeatureCollection", features: [] });
    return;
  }
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const overlays: OverlayData[] = [];
  const imageProjectIds = new Set<string>();
  for (const id of session.overlayIds) {
    const overlay = overlayStore.liveOverlays[id];
    if (!overlay) continue;
    overlays.push(overlay);
    if (overlay.projectId) imageProjectIds.add(overlay.projectId);
  }
  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.status === null && overlay.projectId) imageProjectIds.add(overlay.projectId);
  }
  const projects: Project[] = [];
  for (const id of session.projectIds) {
    const project = projectStore.getMapProjectById(id, session.mode);
    if (project) projects.push(project);
  }
  renderPendingProjectSources(overlays, projects, session.mode, imageProjectIds);
}

function localProjectSourceKey(project: Project): string {
  return JSON.stringify({
    id: project.id,
    status: project.status,
    name: project.name,
    tags: project.tags,
    timelineStatus: project.timelineStatus,
    hasImage: project.hasImage,
    render: project.render,
    geometrySizeM: project.geometrySizeM,
    externalLastModified: project.externalLastModified,
    updatedAt: project.updatedAt,
    geometry: project.geometry,
    lat: project.lat,
    lng: project.lng,
  });
}

function localProjectSourcesKey(): string {
  const keys: string[] = [];
  for (const project of Object.values(useProjectStore().projects)) {
    if (project.isModified || project.status === null) keys.push(localProjectSourceKey(project));
  }
  return keys.toSorted().join("\u0000");
}

function localOverlayImageKey(): string {
  const keys: string[] = [];
  for (const overlay of Object.values(useOverlayStore().liveOverlays)) {
    if (overlay.status === null) keys.push(`${overlay.id}:${overlay.projectId ?? ""}`);
  }
  return keys.toSorted().join("\u0000");
}

function appliedFilters() {
  return activeFilters.value;
}

export function watchPendingProjectSources(): () => void {
  return watch(
    [localProjectSourcesKey, localOverlayImageKey, appliedFilters],
    renderMapSessionPendingSources,
  );
}
