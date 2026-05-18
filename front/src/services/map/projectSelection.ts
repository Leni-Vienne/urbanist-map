import type L from "leaflet";
import type { Project } from "@/types/index";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import {
  createProjectInfoTeleportTargetAtLatLng,
  cleanupProjectInfoTeleportTarget,
} from "@/services/map/projectPopupTeleport";
import { requestScrollTo } from "@/services/layout/accordionState";
import { unhighlightProjectShapes } from "@/services/map/shapeRendering";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { setPopupPlacementForLatLng } from "@/services/map/popupState";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { initializePopupWatcher } from "@/services/map/standaloneProjectMarkers";

/**
 * Open the project info popup and pin the vector highlight for the given project.
 * Called from vector/point clicks, Leaflet shape clicks, and the Contribute sidebar.
 * Passed as a callback to renderProjectShapes so shapeRendering stays dependency-free.
 */
export function selectProject(project: Project, latlng: L.LatLng, atCenter = false): void {
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Ensure the popup-close watcher is active even for overlay-only projects.
  initializePopupWatcher();

  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
    uiStore.closeProjectInfoPopup();
    cleanupProjectInfoTeleportTarget();
    unhighlightProjectShapes(project.id);
    setExternalHover(null);
    return;
  }

  uiStore.openProjectInfoPopup(project.id, project);

  // In view mode, pin the vector tile highlight while the popup is open.
  if (mapStore.mode === "view") {
    setExternalHover(project.id);
  }

  if (uiStore.activeTab === "latest") uiStore.activeTab = "currentLocation";
  requestScrollTo("project", project.id);

  if (overlayStore.showInfoPopup) overlayStore.hideInfoPopup();
  if (overlayStore.idSelectedOverlay) selectOverlay(null);

  setPopupPlacementForLatLng(latlng, atCenter);
  createProjectInfoTeleportTargetAtLatLng(latlng);
}

/**
 * Handle a MapLibre tile click given only a project ID.
 * Looks up the project from the store or fetches it, then delegates to selectProject.
 */
export async function handleProjectClickFromTile(
  projectId: string,
  latlng: L.LatLng,
  atCenter = false,
): Promise<void> {
  const projectStore = useProjectStore();
  let project = projectStore.projects[projectId];
  if (!project) {
    const moderationStore = useModerationStore();
    const pendingProject = moderationStore.projects.find((p) => p.id === projectId);
    if (pendingProject) {
      project = createProjectObject({
        ...pendingProject,
        tags: pendingProject.tags ?? [],
        overlayIds: [],
        city: pendingProject.city
          ? {
              ...pendingProject.city,
              createdAt: new Date(0),
              updatedAt: new Date(0),
              coordinates: { x: 0, y: 0 },
              approvedProjectCount: 0,
            }
          : null,
      });
    } else {
      try {
        const result = await trpc.project.getById.query({ id: projectId });
        if (!result) return;
        project = createProjectObject({
          ...result,
          tags: result.tags ?? [],
          overlayIds: [],
        });
        projectStore.updateProject(projectId, project);
      } catch (error) {
        console.error("Failed to fetch project for tile click:", error);
        return;
      }
    }
  }
  selectProject(project, latlng, atCenter);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
