import { useMapSessionStore } from "@/stores/mapSessionStore";
import { watchEffect } from "vue";
import { getMapOrNull } from "@/services/core/map";
import type { GeoJSONSource } from "maplibre-gl";
import type { Project, RuntimeOverlayData } from "@/types/index";
import { isValidQuad } from "@/services/overlay/transform";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { matchesProjectFilters } from "@/services/core/filters";
import { projectValuesEqual } from "@shared/projectValues";

function matchesPendingProjectFilters(project: Project, hasOverlay: boolean): boolean {
  const lastModified = project.externalLastModified ?? project.updatedAt;
  return matchesProjectFilters({
    tags: project.tags,
    timelineStatus: project.timelineStatus,
    name: project.name,
    geometrySizeM: project.geometrySizeM,
    lastModifiedMs: lastModified.getTime(),
    hasImage:
      project.hasImage === true ||
      hasOverlay ||
      (project.render !== null && project.render !== undefined),
  });
}

function projectFeatureProperties(project: Project) {
  const construction = project.externalProperties?.construction;
  return {
    name: project.name,
    construction: typeof construction === "string" ? construction : null,
    import_source_type: project.importSource?.type ?? null,
    timeline_status: project.timelineStatus,
    tags: JSON.stringify(project.tags),
    first_tag: project.tags[0] ?? null,
  };
}

function createProjectPoint(project: Project, lng: number, lat: number): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [lng, lat],
    },
    properties: {
      id: project.id,
      ...projectFeatureProperties(project),
      status: project.status,
      cell_count: 1,
      render_filename: project.render?.filename,
      render_status: project.render?.status,
    },
  };
}

function createOverlayFootprint(
  project: Project,
  overlay: RuntimeOverlayData,
): GeoJSON.Feature | null {
  const corners = overlay.baselineCorners;
  if (!isValidQuad(corners)) return null;
  const first = corners[0];
  if (!first) return null;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[...corners.map((corner) => [corner.lng, corner.lat]), [first.lng, first.lat]]],
    },
    properties: {
      id: overlay.id,
      project_id: project.id,
      sourceLayer: "overlay-footprints",
      status: overlay.status,
      ...projectFeatureProperties(project),
    },
  };
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
      ...projectFeatureProperties(project),
      render_filename: project.render?.filename,
      render_status: project.render?.status,
      render_lng: project.lng,
      render_lat: project.lat,
      ...style,
    },
  };
}

function appendProjectFeatures(
  project: Project,
  overlays: RuntimeOverlayData[],
  isDraft: boolean,
  points: GeoJSON.Feature[],
  shapes: GeoJSON.Feature[],
): void {
  const { geometry, lat, lng } = project;
  const showProject = isDraft || project.status !== "approved";
  if (isDraft) {
    const original = useProjectStore().getPersistedProject(project.id)?.geometry;
    if (original && original !== geometry && !projectValuesEqual(original, geometry)) {
      shapes.push(
        createProjectShapeFeature(project, original, {
          color: "#9ca3af",
          opacity: 0.4,
          fillOpacity: 0.1,
          hoverOpacity: 0.4,
        }),
      );
    }
  }
  if (geometry && showProject) shapes.push(createProjectShapeFeature(project, geometry));
  if (typeof lat !== "number" || typeof lng !== "number") return;

  let showPoint = showProject;
  for (const overlay of overlays) {
    if (project.status === "approved" && overlay.status === "approved") continue;
    showPoint = true;
    const footprint = createOverlayFootprint(project, overlay);
    if (footprint) shapes.push(footprint);
  }
  if (!geometry && showPoint) points.push(createProjectPoint(project, lng, lat));
}

function getSessionOverlaysByProject(overlayIds: string[]): Map<string, RuntimeOverlayData[]> {
  const overlayStore = useOverlayStore();
  const groups = new Map<string, RuntimeOverlayData[]>();
  for (const id of overlayIds) {
    const overlay = overlayStore.getOverlayById(id);
    if (!overlay?.projectId) continue;
    const group = groups.get(overlay.projectId);
    if (group) group.push(overlay);
    else groups.set(overlay.projectId, [overlay]);
  }
  return groups;
}

export function renderMapSessionPendingSources(): void {
  const points: GeoJSON.Feature[] = [];
  const shapes: GeoJSON.Feature[] = [];
  const session = useMapSessionStore().snapshot;
  if (session && session.mode === useUiStore().mode) {
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const overlaysByProject = getSessionOverlaysByProject(session.overlayIds);
    const localImageProjects = new Set<string>();
    for (const id of Object.keys(overlayStore.overlayDrafts)) {
      const overlay = overlayStore.getOverlayById(id);
      if (overlay?.status === null && overlay.projectId) localImageProjects.add(overlay.projectId);
    }
    const drafts = new Set(session.mode === "edit" ? Object.keys(projectStore.projectDrafts) : []);
    const projectIds = new Set([...drafts, ...overlaysByProject.keys(), ...session.projectIds]);
    for (const id of projectIds) {
      const project = projectStore.getMapProjectById(id, session.mode);
      if (!project) continue;
      const overlays = overlaysByProject.get(id) ?? [];
      const hasOverlay = overlays.length > 0 || localImageProjects.has(id);
      if (matchesPendingProjectFilters(project, hasOverlay)) {
        appendProjectFeatures(project, overlays, drafts.has(id), points, shapes);
      }
    }
  }
  const map = getMapOrNull();
  void map?.getSource<GeoJSONSource>("pending-project-points-source")?.setData({
    type: "FeatureCollection",
    features: points,
  });
  void map?.getSource<GeoJSONSource>("pending-project-shapes-source")?.setData({
    type: "FeatureCollection",
    features: shapes,
  });
}

// Track the state actually read by the source projection, including persisted session entities.
// With no matching session the effect only tracks mode and membership, avoiding entity work.
export function watchPendingProjectSources(): () => void {
  return watchEffect(renderMapSessionPendingSources);
}
