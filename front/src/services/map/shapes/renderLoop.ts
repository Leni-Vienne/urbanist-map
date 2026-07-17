import { watch } from "vue";
import type { AppMode } from "@shared/types";
import type { OverlayData, Project } from "@/types/index";
import { renderProjectShapes, clearAllProjectShapes } from "@/services/map/shapes/rendering";
import { hasProjectShapes } from "@/services/map/shapes/registry";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useMapStore } from "@/stores/mapStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useModerationStore } from "@/stores/moderationStore";
import { getApprovedOverlayDataFromTiles } from "@/services/map/tiles/approvedOverlayCache";
import { createProjectObject } from "@/utils/typeFactories";
import { onModeTransition } from "@/services/map/modeTransition";

/** Shapes are rendered from store data only outside view mode, where vector tiles own them. */
type ShapeRenderMode = Exclude<AppMode, "view">;

/** Return the pending geometry change request value for a project, if any. */
function getPendingGeometry(
  projectId: string,
  mode: ShapeRenderMode,
): GeoJSON.GeometryCollection | null {
  const crList =
    mode === "moderation"
      ? useModerationStore().changeRequests
      : useChangeRequestStore().pendingChangeRequests;
  const cr = crList.find(
    (c) => c.entityType === "project" && c.entityId === projectId && c.fieldName === "geometry",
  );
  // oxlint-disable-next-line no-unsafe-type-assertion
  const geom = cr?.newValue as GeoJSON.GeometryCollection | undefined;
  // oxlint-disable-next-line no-unnecessary-condition
  return geom?.geometries?.length ? geom : null;
}

function resolveProjectGeometry(
  projectId: string,
  approvedGeometry: GeoJSON.GeometryCollection | null | undefined,
  storedGeometry: GeoJSON.GeometryCollection | null | undefined,
  mode: ShapeRenderMode,
): GeoJSON.GeometryCollection | null {
  const approved = (mode === "edit" ? storedGeometry : null) ?? approvedGeometry;
  // oxlint-disable-next-line no-unnecessary-condition
  if (approved?.geometries?.length) return approved;
  return getPendingGeometry(projectId, mode);
}

function normalizeOverlayProject(project: NonNullable<OverlayData["project"]>): Project {
  return createProjectObject({
    ...project,
    overlayIds: [],
    geometry: project.geometry ?? null,
  });
}

/**
 * Collect all visible projects whose shapes need to be rendered.
 * Precondition: not in view mode.
 */
function getVisibleProjectsToRender() {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  const projectsToRender = new Map<string, Project>();

  // Backend overlay data is the project record, so projectData.geometry is the approved geometry.
  for (const overlay of overlayStore.renderLoopOverlays) {
    if (overlay.projectId && overlay.project && !projectsToRender.has(overlay.projectId)) {
      projectsToRender.set(overlay.projectId, normalizeOverlayProject(overlay.project));
    }
  }

  // renderLoopOverlays holds only pending overlays here, so approved-overlay projects
  // are collected from the tile cache to get their shapes rendered too.
  for (const [, overlayData] of getApprovedOverlayDataFromTiles()) {
    const projectId = overlayData.projectId;
    if (!projectId || projectsToRender.has(projectId)) continue;
    // The tile-based OverlayData has no project field; look up the project from the store.
    // Skip if not yet in the store (shape will render on the next cycle once the store is hydrated).
    const p = projectStore.projects[projectId];
    if (p) projectsToRender.set(projectId, p);
  }

  return projectsToRender;
}

function processAndRenderProjectShape(
  projectId: string,
  projectData: Project,
  mode: ShapeRenderMode,
) {
  if (hasProjectShapes(projectId)) return;

  const projectStore = useProjectStore();
  const storedProject = projectStore.projects[projectId];
  const finalGeometry = resolveProjectGeometry(
    projectId,
    projectData.geometry,
    storedProject?.geometry,
    mode,
  );

  let oldGeometry: GeoJSON.GeometryCollection | null = null;
  if (mode === "edit" && storedProject?.isModified) {
    oldGeometry = projectStore.getOriginalProject(projectId)?.geometry ?? null;
  }

  if (!finalGeometry && !oldGeometry) return;

  const projectToRender = (mode === "edit" ? storedProject : null) ?? projectData;

  renderProjectShapes(
    {
      ...projectToRender,
      geometry: finalGeometry ?? { type: "GeometryCollection", geometries: [] },
    },
    oldGeometry,
  );
}

/**
 * Render shapes for all visible projects in edit/moderation mode.
 * Uses project store geometry (not tile data) so unsaved edits are reflected.
 */
export function renderAllProjectShapes() {
  const mode = useMapStore().mode;

  // In view mode, shapes are rendered exclusively via MapLibre vector tiles.
  if (mode === "view") {
    return;
  }

  const projectsToRender = getVisibleProjectsToRender();

  for (const [projectId, projectData] of projectsToRender.entries()) {
    processAndRenderProjectShape(projectId, projectData, mode);
  }
}

export function watchShapeRendering(): () => void {
  const mapStore = useMapStore();
  const changeRequestStore = useChangeRequestStore();
  const moderationStore = useModerationStore();

  const stopChangeRequestWatch = watch(
    () => changeRequestStore.pendingChangeRequests,
    () => {
      if (mapStore.mode === "view") return;
      clearAllProjectShapes();
      renderAllProjectShapes();
    },
  );

  const stopModerationWatch = watch(
    () => moderationStore.moderationLoaded,
    (loaded) => {
      if (!loaded || mapStore.mode !== "moderation") return;
      clearAllProjectShapes();
      renderAllProjectShapes();
    },
  );

  const unregisterModeTransition = onModeTransition("clearProjectShapes", (newMode) => {
    if (newMode === "view") clearAllProjectShapes();
  });

  return function stopShapeRenderingWatchers(): void {
    unregisterModeTransition();
    stopModerationWatch();
    stopChangeRequestWatch();
  };
}
