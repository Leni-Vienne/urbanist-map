import type * as L from "leaflet";
import { watch } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
// Dynamic import for chunk splitting - overlayRendering pulls in leaflet-distortableimage
// which is only needed when the user zooms in far enough to see overlay images
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData, Project } from "@/types/index";
import {
  filterByStatus,
  visibleStates,
  selectedProjectTags,
} from "@/services/overlay/statusFilters";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import {
  renderProjectShapes,
  hasProjectShapes,
  clearAllProjectShapes,
} from "@/services/map/shapeRendering";
import {
  getStandaloneProjectMarkerMap,
  refreshAllStandaloneMarkers,
} from "@/services/map/standaloneProjectMarkers";
import { selectProject } from "@/services/map/projectSelection";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/overlaySelection";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useChangeRequestStore } from "@/stores/pinia/changeRequestStore";
import { createProjectObject } from "@/utils/typeFactories";
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
import { getApprovedOverlayDataFromTiles } from "@/services/map/vectorTileSync";

import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";

// Sync a Leaflet layer's presence on the map to match the desired state
function syncLayerToMap(layer: L.Layer | null, shouldBeOnMap: boolean, mapInstance: L.Map) {
  if (!layer) return;
  const isOnMap = mapInstance.hasLayer(layer);
  if (shouldBeOnMap && !isOnMap) layer.addTo(mapInstance);
  else if (!shouldBeOnMap && isOnMap) layer.remove();
}

// Compute bounding box from 4 overlay corners (avoids Leaflet object allocation / GC pressure).
function computeCornersBBox(corners: { lat: number; lng: number }[]) {
  /* oxlint-disable no-non-null-assertion */
  let minLat = corners[0]!.lat;
  let maxLat = corners[0]!.lat;
  let minLng = corners[0]!.lng;
  let maxLng = corners[0]!.lng;

  for (let i = 1; i < 4; i += 1) {
    const c = corners[i]!;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
  /* oxlint-enable no-non-null-assertion */
}

// Check if a bounding box intersects with viewport bounds (standard AABB intersection test).
// Two rectangles don't intersect only if one is completely outside the other on any axis.
function intersectsViewport(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  bounds: L.LatLngBounds,
) {
  return (
    bbox.maxLat > bounds.getSouth() &&
    bbox.minLat < bounds.getNorth() &&
    bbox.maxLng > bounds.getWest() &&
    bbox.minLng < bounds.getEast()
  );
}

/**
 * Main pruning function: determines what should be on the map based on bounds.
 * Delegates to two structurally disjoint pipelines:
 *   pruneBackendOverlays  for overlays sourced from the backend (status !== null)
 *   pruneLocalOverlays    for local/unsaved overlays only (status === null)
 */
export function runViewportRenderLoop() {
  const mapInstance = map.value;
  const bounds = mapInstance.getBounds();
  const zoom = mapInstance.getZoom();

  // Pad bounds slightly to pre-load items just outside view
  const paddedBounds = bounds.pad(0.1);

  // Prune Overlays
  pruneOverlays(mapInstance, paddedBounds, zoom);
}

// Drains in batches of 10 per frame to keep bulk teardown (e.g. Edit -> View) off the main thread.
// Destruction is cheaper than creation, so the batch can be larger than the init queue.
const destructionQueue = createRafBatchQueue<null>((_, id) => registry.clearEntry(id), 10);

function queueForDestruction(id: string) {
  destructionQueue.enqueue(id, null);
}

/**
 * Prune overlay visibility, dispatches to two structurally disjoint pipelines.
 */
function pruneOverlays(mapInstance: L.Map, bounds: L.LatLngBounds, zoom: number) {
  // Markers start appearing at VIEWPORT_LOAD_THRESHOLD
  // Images start appearing at MIN_ZOOM_FOR_OVERLAYS
  if (zoom < getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD)) return;

  const showImages = zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  // Markers are shown whenever we're past the load threshold, regardless of whether
  // full overlay images are displayed.
  const showMarkers = true;

  // In view mode, all backend overlays are approved and synced by vectorTileSync.
  // pruneBackendOverlays only runs for edit/moderation to manage pending overlays from
  // viewModeOverlays (approved overlays in those modes are still handled by vectorTileSync).
  const mapStore = useMapStore();
  if (mapStore.mode !== "view") {
    pruneBackendOverlays(mapInstance, bounds, showImages, showMarkers);
  }
  pruneLocalOverlays(mapInstance, bounds, showImages, showMarkers);

  // Render shapes for all visible projects (both overlay-bearing and standalone)
  renderAllProjectShapes(mapInstance);
}

/**
 * Pipeline 1: Backend overlays (status !== null).
 * Source of truth: viewModeOverlays (already filtered to status !== null by construction).
 * No overlap with pruneLocalOverlays; backend overlays never have status === null.
 */
function pruneBackendOverlays(
  mapInstance: L.Map,
  bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const filteredOverlays = filterByStatus(overlayStore.viewModeOverlays, mapStore.mode);
  const overlaysToRender: OverlayData[] = [];

  for (const data of filteredOverlays) {
    if (data.corners.length !== 4) continue;

    // Prefer live corners so in-progress edits show up. getCorners() throws before the
    // image loads (leaflet-distortableimage reads _corners[0] unguarded).
    const layer = registry.getLayer(data.id);
    let liveCorners: ReturnType<L.DistortableImageOverlay["getCorners"]> | undefined;
    try {
      liveCorners = layer?.getCorners();
    } catch {
      liveCorners = undefined;
    }
    const effectiveCorners = liveCorners?.length === 4 ? liveCorners : data.corners;

    const isInViewport = intersectsViewport(computeCornersBBox(effectiveCorners), bounds);

    if (isInViewport) {
      if (destructionQueue.has(data.id)) {
        // Timed for destruction but now visible again, save it
        destructionQueue.delete(data.id);
      }

      const marker = registry.getMarker(data.id);

      if (!layer && showImages) {
        // Visible but not instantiated → queue for creation
        overlaysToRender.push(data);
      } else if (layer) {
        syncLayerToMap(layer, showImages, mapInstance);
      }

      if (!marker && showMarkers) {
        const overlayObject = overlayStore.overlays[data.id];
        if (overlayObject) createSingleMarker(overlayObject);
      } else {
        syncLayerToMap(marker, showMarkers, mapInstance);
      }
    } else if (layer || registry.getMarker(data.id)) {
      // Not visible → queue for cleanup
      queueForDestruction(data.id);
    }
  }

  // Destroy markers/layers for overlays that are filtered OUT by completion status.
  // pruneLocalOverlays handles this correctly; mirror the same logic here so that
  // toggling a filter off immediately removes the corresponding backend markers.
  const filteredIds = new Set(filteredOverlays.map((o) => o.id));
  for (const data of overlayStore.viewModeOverlays) {
    if (filteredIds.has(data.id)) continue;
    const marker = registry.getMarker(data.id);
    const layer = registry.getLayer(data.id);
    if (marker || layer) {
      queueForDestruction(data.id);
    }
  }

  if (overlaysToRender.length > 0) {
    // Dynamic import keeps leaflet-distortableimage out of the initial bundle
    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(overlaysToRender, true);
    });
  }
}

/**
 * Pipeline 2: Local/unsaved overlays only (status === null).
 * Source: overlayStore.overlays filtered to status === null.
 * Structural gate: if status !== null, skip immediately.
 * These overlays are only visible in edit mode.
 */
function pruneLocalOverlays(
  mapInstance: L.Map,
  _bounds: L.LatLngBounds,
  showImages: boolean,
  showMarkers: boolean,
) {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const mapStore = useMapStore();
  const editOverlaysToRecreate: OverlayObject[] = [];

  for (const [id, overlay] of Object.entries(overlayStore.overlays)) {
    // STRUCTURAL GATE, this pipeline owns local overlays exclusively.
    // Backend overlays (status !== null) are handled by pruneBackendOverlays.
    if (overlay.status !== null) continue;

    if (overlay.corners.length !== 4) continue;

    const isAllowedByMode = isOverlayVisible(overlay, mapStore.mode, authStore.user?.id);
    const passesCompletionFilter = filterByStatus([overlay], mapStore.mode).length > 0;

    const layer = registry.getLayer(id);

    // Local overlays are actively being created by the user, no viewport bounds check.
    // overlay.corners is NOT updated during drag, and even live layer corners can be
    // outside the viewport if moveend fires while the overlay has been moved off-screen.
    // Only explicit deletion or a mode switch should remove a local overlay.
    const shouldDisplay = isAllowedByMode && passesCompletionFilter;

    if (shouldDisplay) {
      if (destructionQueue.has(id)) {
        destructionQueue.delete(id);
      }

      const marker = registry.getMarker(id);

      if (!layer && showImages) {
        editOverlaysToRecreate.push(overlay);
      } else if (layer) {
        syncLayerToMap(layer, showImages, mapInstance);
      }

      if (!marker && showMarkers) {
        createSingleMarker(overlay);
      } else {
        syncLayerToMap(marker, showMarkers, mapInstance);
      }
    } else {
      const marker = registry.getMarker(id);
      if (layer || marker) {
        queueForDestruction(id);
      }
    }
  }

  if (editOverlaysToRecreate.length > 0) {
    // Dynamic import keeps leaflet-distortableimage out of the initial bundle
    // Capture mode at queue time so beginCreation's atomic mutex prevents races,
    // no manual queuedMode re-check needed (beginCreation returns false if race occurred).
    void import("@/services/overlay/overlayRendering").then(({ createLeafletOverlay }) => {
      for (const overlay of editOverlaysToRecreate) {
        // beginCreation is the single atomic gate:
        //   - returns false if already has a layer (concurrent pruneOverlays call completed first)
        //   - returns false if already being created (in-flight async callback)
        // No separate mode re-check or overlay.overlay guard needed.
        if (!registry.beginCreation(overlay.id)) continue;

        // Pass onReady so the creation mutex is released when the image finishes loading.
        // createLeafletOverlay handles cancelCreation itself on abort/zoom-too-low paths.
        const id = overlay.id;
        const newOverlay = createLeafletOverlay(overlay.imageUrl, overlay, () => {
          registry.cancelCreation(id);
        });

        if (!newOverlay) {
          // Synchronous creation failure (e.g., invalid overlay object)
          registry.cancelCreation(overlay.id);
        }
      }
    });
  }
}

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

type ResolvedGeometry = { geometry: GeoJSON.GeometryCollection; isPending: boolean } | null;

function resolveProjectGeometry(
  projectId: string,
  approvedGeometry: GeoJSON.GeometryCollection | null | undefined,
  storedGeometry: GeoJSON.GeometryCollection | null | undefined,
  isEditMode: boolean,
  isModeration: boolean,
): ResolvedGeometry {
  const approved = (isEditMode ? storedGeometry : null) ?? approvedGeometry;
  if (approved?.geometries?.length) return { geometry: approved, isPending: false };
  if (!isEditMode && !isModeration) return null;
  const pending = getPendingGeometry(projectId, isModeration);
  return pending ? { geometry: pending, isPending: true } : null;
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

  // Collect standalone projects
  for (const projectId of getStandaloneProjectMarkerMap().keys()) {
    if (!projectsToRender.has(projectId)) {
      const p = projectStore.projects[projectId];
      if (p) {
        projectsToRender.set(projectId, p);
      }
    }
  }

  return projectsToRender;
}

function processAndRenderProjectShape(
  projectId: string,
  projectData: Project,
  mapInstance: L.Map,
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

  let finalGeometry = resolved?.geometry;
  let isPending = resolved?.isPending;

  // Fallback: new local projects may lack an approved geometry.
  // In edit mode, render their local geometry instead.
  if (
    !finalGeometry &&
    isEditMode &&
    storedProject?.status === null &&
    storedProject.geometry?.geometries?.length
  ) {
    finalGeometry = storedProject.geometry;
    isPending = false;
  }

  if (!finalGeometry) return;

  const projectToRender = (isEditMode ? storedProject : null) ?? projectData;

  renderProjectShapes(
    { ...projectToRender, geometry: finalGeometry },
    mapInstance,
    selectProject,
    highlightProject,
    removeProjectOutlines,
    isPending ? "yellow" : undefined,
  );
}

/**
 * Render shapes for all visible projects in edit/moderation mode.
 * Uses project store geometry (not tile data) so unsaved edits are reflected.
 */
function renderAllProjectShapes(mapInstance: L.Map) {
  const mapStore = useMapStore();

  // In view mode, shapes are rendered exclusively via MapLibre vector tiles.
  if (mapStore.mode === "view") {
    return;
  }

  const isEditMode = mapStore.mode === "edit";
  const isModeration = mapStore.mode === "moderation";

  const projectsToRender = getVisibleProjectsToRender();

  for (const [projectId, projectData] of projectsToRender.entries()) {
    processAndRenderProjectShape(projectId, projectData, mapInstance, isEditMode, isModeration);
  }
}

// Data-load / filter / mode triggers that all collapse to "re-run the render loop".
export function initializeRenderTriggers() {
  const mapStore = useMapStore();
  const changeRequestStore = useChangeRequestStore();
  const moderationStore = useModerationStore();

  watch(
    () => ({ status: visibleStates.value, tags: selectedProjectTags.value }),
    () => {
      refreshAllStandaloneMarkers();
      runViewportRenderLoop();
    },
    { deep: true },
  );

  watch(
    () => changeRequestStore.pendingChangeRequests,
    () => {
      if (mapStore.mode === "view") return;
      clearAllProjectShapes();
      runViewportRenderLoop();
    },
  );

  watch(
    () => moderationStore.moderationLoaded,
    (loaded) => {
      if (!loaded || mapStore.mode !== "moderation") return;
      clearAllProjectShapes();
      runViewportRenderLoop();
    },
  );

  // Entering view mode: MapLibre vector tiles take over from Leaflet shape rendering.
  watch(
    () => mapStore.mode,
    (newMode) => {
      if (newMode === "view") clearAllProjectShapes();
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
