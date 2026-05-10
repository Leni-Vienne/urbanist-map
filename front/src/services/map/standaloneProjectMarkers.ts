import L from "leaflet";
import { watch } from "vue";
import type { Project } from "@/types/index";
import { map } from "@/services/core/map";
import { createStandaloneProjectIcon } from "@/services/map/markers";
import {
  visibleStates,
  selectedProjectTags,
  filterByStatus,
  shouldShowStandaloneProject,
} from "@/services/overlay/statusFilters";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useUiStore } from "@/stores/uiStore";
import {
  selectOverlay,
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import {
  createProjectInfoTeleportTarget,
  createProjectInfoTeleportTargetAtLatLng,
  cleanupProjectInfoTeleportTarget,
} from "@/services/map/projectPopupTeleport";
import { requestScrollTo } from "@/services/layout/accordionState";
import { getProjectMarkerColor } from "@/utils/markerColors";
import {
  renderProjectShapes,
  clearAllProjectShapes,
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeRendering";
import { setOverlayDrivenHover } from "@/services/map/vectorHoverState";
import { setPopupPlacementForLatLng } from "@/services/map/popupState";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
// t() is imported directly since useI18n() is only available inside component setup().
import { t } from "@/locales";

// Layer group for standalone projects (standalone project markers)
let standaloneProjectsLayer: L.LayerGroup | null = null;

// Map to store project ID to marker references for easy lookup
const standaloneProjectMarkerMap = new Map<string, L.Marker>();

// Track the currently selected standalone project marker (for opacity control)
let selectedStandaloneProjectMarker: L.Marker | null = null;

// Track if watcher has been initialized (lazy initialization to avoid Pinia issues)
let isWatcherInitialized = false;

/** Initialize watchers for standalone markers. Called once on first use to avoid Pinia initialization issues. */
function initializePopupWatcher() {
  if (isWatcherInitialized) return;

  const uiStore = useUiStore();
  watch(
    () => uiStore.projectInfoPopup.visible,
    (isVisible, wasVisible) => {
      // When popup closes, reset marker opacity and release any pinned vector hover.
      if (wasVisible && !isVisible) {
        updateStandaloneProjectMarkerOpacities(null);
        setOverlayDrivenHover(null);
      }
    },
  );

  // Watch filter changes: refresh standalone markers AND sync overlay marker visibility.
  // runViewportRenderLoop is NOT called, it runs on the next map event and handles proper
  // destruction; here we only need an immediate show/hide pass that works at all zoom levels.
  watch(
    () => ({
      status: visibleStates.value,
      tags: selectedProjectTags.value,
    }),
    () => {
      refreshAllStandaloneMarkers();

      // Sync overlay marker visibility to the current completion filter
      const overlayStore = useOverlayStore();
      const mapStore = useMapStore();
      const mapInstance = map.value;
      const filteredIds = new Set(
        filterByStatus(overlayStore.viewModeOverlays, mapStore.mode).map((o) => o.id),
      );
      for (const id of Object.keys(overlayStore.overlays)) {
        const marker = registry.getMarker(id);
        if (!marker) continue;
        const shouldBeVisible = filteredIds.has(id);
        const isOnMap = mapInstance.hasLayer(marker);
        if (shouldBeVisible && !isOnMap) marker.addTo(mapInstance);
        else if (!shouldBeVisible && isOnMap) marker.remove();
      }
    },
    { deep: true },
  );

  isWatcherInitialized = true;
}

/** Returns the standalone project marker for a given project ID. */
export function getStandaloneProjectMarkerByProjectId(projectId: string): L.Marker | undefined {
  return standaloneProjectMarkerMap.get(projectId);
}

/** Scale up a standalone project marker on hover. */
export function highlightStandaloneProjectMarker(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;
  const el = marker.getElement();
  if (!el) return;
  const svg = el.querySelector("svg");
  if (svg) {
    svg.style.transformOrigin = "center bottom";
    svg.style.transition = "transform 0.15s ease";
    svg.style.transform = "scale(1.5)";
  }
  el.style.zIndex = "1000";
}

/** Reset a standalone project marker scale after hover leave. */
export function unhighlightStandaloneProjectMarker(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;
  const el = marker.getElement();
  if (!el) return;
  const svg = el.querySelector("svg");
  if (svg) {
    svg.style.transform = "";
  }
  el.style.zIndex = "";
}

/** Remove the standalone project marker for a given project (called when the first overlay is added). */
export function removeStandaloneProjectMarkerForProject(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;

  const uiStore = useUiStore();
  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
    uiStore.closeProjectInfoPopup();
  }

  if (standaloneProjectsLayer?.hasLayer(marker)) {
    standaloneProjectsLayer.removeLayer(marker);
  }

  standaloneProjectMarkerMap.delete(projectId);
}

/** Remove all standalone project markers from the map. */
export function clearAllStandaloneProjectMarkers(): void {
  for (const marker of standaloneProjectMarkerMap.values()) {
    marker.off();
    if (standaloneProjectsLayer?.hasLayer(marker)) {
      standaloneProjectsLayer.removeLayer(marker);
    }
  }

  if (standaloneProjectsLayer) {
    map.value.removeLayer(standaloneProjectsLayer);
    standaloneProjectsLayer = null;
  }

  standaloneProjectMarkerMap.clear();
  selectedStandaloneProjectMarker = null;
  clearAllProjectShapes();
}

/** Show/hide standalone markers based on the current completion filters. */
function refreshAllStandaloneMarkers(): void {
  if (!standaloneProjectsLayer) return;

  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  for (const [projectId, marker] of standaloneProjectMarkerMap.entries()) {
    const project = projectStore.projects[projectId];
    if (!project) continue;

    const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

    if (shouldBeVisible && !standaloneProjectsLayer.hasLayer(marker)) {
      standaloneProjectsLayer.addLayer(marker);
    } else if (!shouldBeVisible && standaloneProjectsLayer.hasLayer(marker)) {
      standaloneProjectsLayer.removeLayer(marker);
    }
  }
}

/**
 * Bind or update the tooltip on a standalone marker.
 * Tooltips are only shown in edit and moderation modes.
 */
export function updateStandaloneProjectMarkerTooltip(
  marker: L.Marker,
  project: Project,
  mode: "view" | "edit" | "moderation",
): void {
  if (mode === "view") {
    if (marker.getTooltip()) {
      marker.unbindTooltip();
    }
    return;
  }

  let tooltipText = "";
  let modifierText = "";

  if (mode === "moderation") {
    switch (project.status) {
      case "pending":
        tooltipText = t("markerTooltip.project.pendingApproval");
        break;
      case "approved":
        tooltipText = t("common.approved");
        break;
      case "rejected":
        tooltipText = t("markerTooltip.project.rejected");
        break;
      default:
        tooltipText = t("markerTooltip.project.newProject");
    }
  } else if (mode === "edit") {
    const hasBeenModified = project.isModified ?? false;
    const status = project.status;

    if (status === "pending") {
      tooltipText = t("markerTooltip.project.pendingApproval");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.project.modified");
      }
    } else if (status === "approved") {
      tooltipText = t("common.approved");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.project.modified");
      }
    } else if (status === "rejected") {
      tooltipText = t("markerTooltip.project.rejected");
    } else if (hasBeenModified) {
      tooltipText = t("markerTooltip.project.localProject");
    } else {
      tooltipText = t("markerTooltip.project.newProject");
    }
  }

  const finalTooltipText = modifierText ? `${tooltipText} (${modifierText})` : tooltipText;

  if (marker.getTooltip()) {
    marker.setTooltipContent(finalTooltipText);
  } else {
    marker.bindTooltip(finalTooltipText, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });
  }
}

/** Dim all standalone markers except the selected one. */
function updateStandaloneProjectMarkerOpacities(selectedMarker: L.Marker | null) {
  if (!standaloneProjectsLayer) return;

  selectedStandaloneProjectMarker = selectedMarker;

  standaloneProjectsLayer.eachLayer((marker) => {
    if (marker instanceof L.Marker) {
      if (selectedMarker && marker === selectedMarker) {
        marker.setOpacity(MARKER_OPACITY.standalone.hover);
      } else {
        marker.setOpacity(MARKER_OPACITY.standalone.default);
      }
    }
  });
}

/**
 * Handle a click on a project shape layer.
 * Passed as a callback to renderProjectShapes so shapeRendering stays dependency-free.
 */
export function handleShapeProjectClick(
  project: Project,
  latlng: L.LatLng,
  atCenter = false,
): void {
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Ensure the popup-close watcher is active even for overlay-only projects.
  initializePopupWatcher();

  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
    uiStore.closeProjectInfoPopup();
    cleanupProjectInfoTeleportTarget();
    unhighlightProjectShapes(project.id);
    setOverlayDrivenHover(null); // Release the pinned vector highlight immediately.
    return;
  }

  uiStore.openProjectInfoPopup(project.id, project);

  // In view mode, pin the vector tile highlight while the popup is open.
  if (mapStore.mode === "view") {
    setOverlayDrivenHover(project.id);
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
 * Looks up the project from the store or fetches it, then delegates to handleShapeProjectClick.
 */
export async function handleProjectClickFromTile(
  projectId: string,
  latlng: L.LatLng,
  atCenter = false,
): Promise<void> {
  const projectStore = useProjectStore();
  let project = projectStore.projects[projectId];
  if (!project) {
    // Check moderation store for pending projects before hitting the API
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
  handleShapeProjectClick(project, latlng, atCenter);
}

/** Add a standalone project marker (called when the last overlay of a project is removed). */
export function addStandaloneProjectMarkerForProject(project: Project): void {
  if (!project.lat || !project.lng) return;

  if (standaloneProjectMarkerMap.has(project.id)) return;

  if (project.geometry?.geometries.length) {
    renderProjectShapes(
      project,
      map.value,
      handleShapeProjectClick,
      highlightProjectOverlaysOnHover,
      removeProjectOutlines,
    );
  }

  initializePopupWatcher();

  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

  if (!standaloneProjectsLayer) {
    standaloneProjectsLayer = L.layerGroup();
    standaloneProjectsLayer.addTo(map.value);
  }

  // Store project in projectStore so color updates can find it later
  // (viewport-loaded markers aren't always loaded via the city fetch path).
  const projectStore = useProjectStore();
  if (!projectStore.projects[project.id]) {
    projectStore.projects = {
      ...projectStore.projects,
      [project.id]: project,
    };
  }

  const markerIcon = createStandaloneProjectIcon(markerColor);

  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.standalone.default,
  });

  // Store marker before adding to layer so refreshAllStandaloneMarkers can find it.
  standaloneProjectMarkerMap.set(project.id, marker);

  if (shouldBeVisible) {
    standaloneProjectsLayer.addLayer(marker);
  }

  marker.on("dblclick", (e) => {
    L.DomEvent.stopPropagation(e);
  });

  marker.on("mouseover", () => {
    marker.setOpacity(MARKER_OPACITY.standalone.hover);
    highlightProjectShapes(project.id);
  });

  marker.on("mouseout", () => {
    if (selectedStandaloneProjectMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.standalone.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.standalone.default);
    }
    const uiStore = useUiStore();
    const popupIsOpenForThis =
      uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id;
    if (!popupIsOpenForThis) {
      unhighlightProjectShapes(project.id);
    }
  });

  updateStandaloneProjectMarkerTooltip(marker, project, mapStore.mode);

  marker.on("click", (e) => {
    void (async () => {
      L.DomEvent.stopPropagation(e);
      const uiStore = useUiStore();

      if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
        uiStore.closeProjectInfoPopup();
        updateStandaloneProjectMarkerOpacities(null);
        return;
      }

      uiStore.openProjectInfoPopup(project.id, project);

      if (uiStore.activeTab === "latest") {
        uiStore.activeTab = "currentLocation";
      }

      requestScrollTo("project", project.id);

      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }

      if (overlayStore.idSelectedOverlay) {
        selectOverlay(null);
      }

      createProjectInfoTeleportTarget(marker);
      updateStandaloneProjectMarkerOpacities(marker);
    })();
  });
}

/** Returns the internal standalone marker map. */
export function getStandaloneProjectMarkerMap(): Map<string, L.Marker> {
  return standaloneProjectMarkerMap;
}

/** Update the icon color of a standalone project marker. */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  const markerIcon = createStandaloneProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

/** Close the project popup and reset all marker opacities. */
export function closeProjectPopupAndResetMarkers() {
  cleanupProjectInfoTeleportTarget();
  updateStandaloneProjectMarkerOpacities(null);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
