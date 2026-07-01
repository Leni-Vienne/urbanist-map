import { watch } from "vue";
import type { OverlayData, Project } from "@/types/index";
import { renderProjectShapes, clearAllProjectShapes } from "@/services/map/shapes/rendering";
import { hasProjectShapes } from "@/services/map/shapes/registry";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useChangeRequestStore } from "@/stores/pinia/changeRequestStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { getApprovedOverlayDataFromTiles } from "@/services/map/tiles/sync";
import { createProjectObject } from "@/utils/typeFactories";

/** Return the pending geometry change request value for a project, if any. */
function getPendingGeometry(
  projectId: string,
  isModeration: boolean,
): GeoJSON.GeometryCollection | null {
  const crList = isModeration
    ? useModerationStore().changeRequests
    : useChangeRequestStore().pendingChangeRequests;
  const cr = crList.find(
    (c) => c.entityType === "project" && c.entityId === projectId && c.fieldName === "geometry",
  );
  const geom = cr?.newValue as GeoJSON.GeometryCollection | undefined;
  return geom?.geometries?.length ? geom : null;
}

type ResolvedGeometry = { geometry: GeoJSON.GeometryCollection } | null;

function resolveProjectGeometry(
  projectId: string,
  approvedGeometry: GeoJSON.GeometryCollection | null | undefined,
  storedGeometry: GeoJSON.GeometryCollection | null | undefined,
  isEditMode: boolean,
  isModeration: boolean,
): ResolvedGeometry {
  const approved = (isEditMode ? storedGeometry : null) ?? approvedGeometry;
  if (approved?.geometries?.length) return { geometry: approved };
  if (!isEditMode && !isModeration) return null;
  const pending = getPendingGeometry(projectId, isModeration);
  return pending ? { geometry: pending } : null;
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
 * In edit/moderation mode: uses project store geometry for unsaved changes.
 * In view mode: shapes are handled by MapLibre tiles, this function is not called.
 */
function getVisibleProjectsToRender() {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();
  const mapStore = useMapStore();

  const projectsToRender = new Map<string, Project>();

  // Collect projects with overlays, always use backend overlay data as the project record
  // so that projectData.geometry is always the approved geometry. storedProject is looked
  // up separately in processAndRenderProjectShape for edit-mode rendering.
  for (const overlay of overlayStore.viewModeOverlays) {
    if (overlay.projectId && overlay.project && !projectsToRender.has(overlay.projectId)) {
      projectsToRender.set(overlay.projectId, normalizeOverlayProject(overlay.project));
    }
  }

  // In edit/moderation mode, viewModeOverlays only contains pending overlays.
  // Approved overlays are rendered by vectorTileSync, collect their project IDs from
  // the tile cache so that approved-overlay projects still get their shapes rendered.
  if (mapStore.mode !== "view") {
    for (const [, overlayData] of getApprovedOverlayDataFromTiles()) {
      const projectId = overlayData.projectId;
      if (!projectId || projectsToRender.has(projectId)) continue;
      // The tile-based OverlayData has no project field; look up the project from the store.
      // Skip if not yet in the store (shape will render on the next cycle once the store is hydrated).
      const p = projectStore.projects[projectId];
      if (p) projectsToRender.set(projectId, p);
    }
  }

  return projectsToRender;
}

function processAndRenderProjectShape(
  projectId: string,
  projectData: Project,
  isEditMode: boolean,
  isModeration: boolean,
) {
  if (hasProjectShapes(projectId)) return;

  const projectStore = useProjectStore();
  const storedProject = projectStore.projects[projectId];
  const resolved = resolveProjectGeometry(
    projectId,
    projectData.geometry,
    storedProject?.geometry,
    isEditMode,
    isModeration,
  );

  const finalGeometry = resolved?.geometry;

  let oldGeometry: GeoJSON.GeometryCollection | null = null;
  if (isEditMode && storedProject?.isModified) {
    oldGeometry = projectStore.getOriginalProject(projectId)?.geometry ?? null;
  }

  if (!finalGeometry && !oldGeometry) return;

  const projectToRender = (isEditMode ? storedProject : null) ?? projectData;

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
  const mapStore = useMapStore();

  // In view mode, shapes are rendered exclusively via MapLibre vector tiles.
  if (mapStore.mode === "view") {
    return;
  }

  const isEditMode = mapStore.mode === "edit";
  const isModeration = mapStore.mode === "moderation";

  const projectsToRender = getVisibleProjectsToRender();

  for (const [projectId, projectData] of projectsToRender.entries()) {
    processAndRenderProjectShape(projectId, projectData, isEditMode, isModeration);
  }
}

/**
 * Shape-specific render triggers: change requests, moderation load, entering view mode.
 * Overlay-pruning triggers (filters, tags) live in viewportRenderLoop's initializeRenderTriggers.
 */
let shapeRenderTriggersInitialized = false;

export function initializeShapeRenderTriggers() {
  if (shapeRenderTriggersInitialized) return;
  shapeRenderTriggersInitialized = true;

  const mapStore = useMapStore();
  const changeRequestStore = useChangeRequestStore();
  const moderationStore = useModerationStore();

  watch(
    () => changeRequestStore.pendingChangeRequests,
    () => {
      if (mapStore.mode === "view") return;
      clearAllProjectShapes();
      renderAllProjectShapes();
    },
  );

  watch(
    () => moderationStore.moderationLoaded,
    (loaded) => {
      if (!loaded || mapStore.mode !== "moderation") return;
      clearAllProjectShapes();
      renderAllProjectShapes();
    },
  );

  // Entering view mode: MapLibre vector tiles take over shape rendering.
  watch(
    () => mapStore.mode,
    (newMode) => {
      if (newMode === "view") clearAllProjectShapes();
    },
  );
}
