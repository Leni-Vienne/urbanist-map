import { watch } from "vue";
import type { AppMode } from "@shared/types";
import type { Project } from "@/types/index";
import { renderProjectShapes, clearAllProjectShapes } from "@/services/map/shapes/rendering";
import { hasProjectShapes } from "@/services/map/shapes/registry";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useModerationStore } from "@/stores/moderationStore";
import { getApprovedOverlayDataFromTiles } from "@/services/map/tiles/approvedOverlayCache";
import { onModeTransition } from "@/services/map/modeTransition";
import { getMapSessionSnapshot } from "@/services/map/mapSessionState";

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

/**
 * Collect all visible projects whose shapes need to be rendered.
 * Precondition: not in view mode.
 */
function getVisibleProjectsToRender(mode: ShapeRenderMode) {
  const projectStore = useProjectStore();

  const projectsToRender = new Map<string, Project>();

  const mapSession = getMapSessionSnapshot();
  const sessionOverlayIds = mapSession?.mode === mode ? mapSession.overlayIds : [];
  const overlayStore = useOverlayStore();
  for (const overlayId of sessionOverlayIds) {
    const overlay = overlayStore.liveOverlays[overlayId];
    if (!overlay?.projectId || projectsToRender.has(overlay.projectId)) continue;
    const project = projectStore.getMapProjectById(overlay.projectId, mode);
    if (project) projectsToRender.set(overlay.projectId, project);
  }

  // The map session holds only pending overlays here, so approved-overlay projects
  // are collected from the tile cache to get their shapes rendered too.
  for (const [, overlayData] of getApprovedOverlayDataFromTiles()) {
    const projectId = overlayData.projectId;
    if (!projectId || projectsToRender.has(projectId)) continue;
    // The tile payload has no project field; look up the project from the store.
    // Skip if not yet in the store (shape will render on the next cycle once the store is hydrated).
    const p = projectStore.getMapProjectById(projectId, mode);
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

  const projectsToRender = getVisibleProjectsToRender(mode);

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
