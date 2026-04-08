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
// useI18n() uses Vue's inject() mechanism which is only available synchronously during the setup() phase of a component.
import { t } from "@/locales";

// Layer group for standalone projects (standalone project markers)
let standaloneProjectsLayer: L.LayerGroup | null = null;

// Map to store project ID to marker references for easy lookup
const standaloneProjectMarkerMap = new Map<string, L.Marker>();

// Track the currently selected standalone project marker (for opacity control)
let selectedStandaloneProjectMarker: L.Marker | null = null;

// Track if watcher has been initialized (lazy initialization to avoid Pinia issues)
let isWatcherInitialized = false;

/**
 * Initialize watchers for standalone markers (lazy initialization)
 * Called once when first marker is added to avoid Pinia initialization issues
 */
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
  // runViewportRenderLoop is NOT called — it runs on the next map event and handles proper
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

/**
 * Get standalone project marker by project ID
 */
export function getStandaloneProjectMarkerByProjectId(projectId: string): L.Marker | undefined {
  return standaloneProjectMarkerMap.get(projectId);
}

/**
 * Scale up a standalone project marker for hover highlight (e.g. from side panel).
 */
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

/**
 * Reset the scale of a standalone project marker after hover leave.
 */
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

/**
 * Remove standalone project marker for a specific project
 * This is called when the first overlay is added to a standalone project
 */
export function removeStandaloneProjectMarkerForProject(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;

  // Close project info popup if it's showing info for this project
  const uiStore = useUiStore();
  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
    uiStore.closeProjectInfoPopup();
  }

  // Remove marker from map
  if (standaloneProjectsLayer?.hasLayer(marker)) {
    standaloneProjectsLayer.removeLayer(marker);
  }

  // Remove marker from map
  standaloneProjectMarkerMap.delete(projectId);
}

/**
 * Clear all standalone project markers from the map
 * This is called when switching cities to prevent marker accumulation
 */
export function clearAllStandaloneProjectMarkers(): void {
  // Properly remove all markers and their event listeners
  for (const marker of standaloneProjectMarkerMap.values()) {
    // Remove all event listeners before removing from map
    marker.off();
    // Remove from layer if it exists
    if (standaloneProjectsLayer?.hasLayer(marker)) {
      standaloneProjectsLayer.removeLayer(marker);
    }
  }

  // Now remove the layer from map
  if (standaloneProjectsLayer) {
    map.value.removeLayer(standaloneProjectsLayer);
    standaloneProjectsLayer = null;
  }

  standaloneProjectMarkerMap.clear();
  selectedStandaloneProjectMarker = null;
  clearAllProjectShapes();
}

/**
 * Refresh all standalone markers visibility based on current completion filters
 * This is called when completion filters change
 */
function refreshAllStandaloneMarkers(): void {
  if (!standaloneProjectsLayer) return;

  const mapStore = useMapStore();
  const projectStore = useProjectStore();

  // Iterate through all existing markers
  for (const [projectId, marker] of standaloneProjectMarkerMap.entries()) {
    const project = projectStore.projects[projectId];
    if (!project) continue;

    // Get marker color for this project
    // Check if this marker should be visible
    const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

    // Show or hide the marker based on filter
    if (shouldBeVisible && !standaloneProjectsLayer.hasLayer(marker)) {
      // Add to layer if not already there
      standaloneProjectsLayer.addLayer(marker);
    } else if (!shouldBeVisible && standaloneProjectsLayer.hasLayer(marker)) {
      // Remove from layer if it's there
      standaloneProjectsLayer.removeLayer(marker);
    }
  }
}

/**
 * Update standalone project marker tooltip based on project status
 * Only shows tooltips in edit and moderation modes (similar to overlay markers)
 * @param marker - The marker to update
 * @param project - The project data
 * @param mode - Current map mode
 */
export function updateStandaloneProjectMarkerTooltip(
  marker: L.Marker,
  project: Project,
  mode: "view" | "edit" | "moderation",
): void {
  // Only show tooltips in edit and moderation modes (view mode doesn't need them)
  if (mode === "view") {
    if (marker.getTooltip()) {
      marker.unbindTooltip();
    }
    return;
  }

  let tooltipText = "";
  let modifierText = "";

  if (mode === "moderation") {
    // Moderation mode: Show approval status
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
    // Edit mode: Show status with modified state
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

  // Assemble final tooltip text with modifier in parentheses if present
  const finalTooltipText = modifierText ? `${tooltipText} (${modifierText})` : tooltipText;

  // Update tooltip content if it exists, otherwise bind new one
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

/**
 * Update standalone project marker opacities based on selected marker
 */
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
 * Handle a click on a project shape layer — opens the project info popup.
 * Passed as a callback to renderProjectShapes so shapeRendering stays dependency-free.
 */
export function handleShapeProjectClick(project: Project, latlng: L.LatLng): void {
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Ensure the popup-close watcher is always active, even for overlay-only projects that
  // never go through addStandaloneProjectMarkerForProject (which is the usual init path).
  initializePopupWatcher();

  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
    // Toggle off: user clicked the same project again to close the popup.
    uiStore.closeProjectInfoPopup();
    cleanupProjectInfoTeleportTarget();
    unhighlightProjectShapes(project.id);
    setOverlayDrivenHover(null); // Release the pinned vector highlight immediately.
    return;
  }

  uiStore.openProjectInfoPopup(project.id, project);

  // In view mode, pin the vector tile highlight so the overlay footprint / shape stays
  // highlighted while the popup is open (not just while the mouse is over the feature).
  // The initializePopupWatcher above clears this when the popup eventually closes.
  if (mapStore.mode === "view") {
    setOverlayDrivenHover(project.id);
  }

  if (uiStore.activeTab === "latest") uiStore.activeTab = "currentLocation";
  requestScrollTo("project", project.id);

  if (overlayStore.showInfoPopup) overlayStore.hideInfoPopup();
  if (overlayStore.idSelectedOverlay) selectOverlay(null);

  setPopupPlacementForLatLng(latlng);
  createProjectInfoTeleportTargetAtLatLng(latlng);
}

/**
 * Handle a click on a MapLibre tile layer feature by project ID.
 * Looks up the project from the store; if found delegates to handleShapeProjectClick.
 * Used by tile layer click handlers that only have the project ID available.
 */
export async function handleProjectClickFromTile(
  projectId: string,
  latlng: L.LatLng,
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
  handleShapeProjectClick(project, latlng);
}

/**
 * Add standalone project marker for a specific project
 * This is called when the last overlay is deleted from a project
 */
export function addStandaloneProjectMarkerForProject(project: Project): void {
  if (!project.lat || !project.lng) return;

  // Don't add if marker already exists
  if (standaloneProjectMarkerMap.has(project.id)) return;

  // Projects with geometry also render shapes (in addition to the point marker below).
  if (project.geometry?.geometries.length) {
    renderProjectShapes(
      project,
      map.value,
      handleShapeProjectClick,
      highlightProjectOverlaysOnHover,
      removeProjectOutlines,
    );
  }

  // Initialize popup watcher on first marker addition (lazy initialization)
  initializePopupWatcher();

  // Get marker color and check if it should be visible based on current filter
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  const shouldBeVisible = shouldShowStandaloneProject(project, mapStore.mode);

  // Ensure standalone project layer exists
  if (!standaloneProjectsLayer) {
    standaloneProjectsLayer = L.layerGroup();
    standaloneProjectsLayer.addTo(map.value);
  }

  // CRITICAL: Store project in projectStore so it can be found later for color updates
  // This is necessary for viewport-loaded markers where projects aren't loaded via loadCityStandaloneProjects
  const projectStore = useProjectStore();
  if (!projectStore.projects[project.id]) {
    projectStore.projects = {
      ...projectStore.projects,
      [project.id]: project,
    };
  }

  const markerIcon = createStandaloneProjectIcon(markerColor);

  // Create marker
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.standalone.default,
  });

  // Store marker in map BEFORE adding to layer (so refresh function can find it)
  standaloneProjectMarkerMap.set(project.id, marker);

  // Only add to layer if it passes the completion filter
  if (shouldBeVisible) {
    standaloneProjectsLayer.addLayer(marker);
  }

  // Prevent double-click zoom on markers
  marker.on("dblclick", (e) => {
    L.DomEvent.stopPropagation(e);
  });

  // Add mouseover event to increase marker opacity and highlight shapes
  marker.on("mouseover", () => {
    marker.setOpacity(MARKER_OPACITY.standalone.hover);
    highlightProjectShapes(project.id);
  });

  // Add mouseout event to reset marker opacity and unhighlight shapes (unless persistently highlighted)
  marker.on("mouseout", () => {
    if (selectedStandaloneProjectMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.standalone.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.standalone.default);
    }
    const uiStore = useUiStore();
    const isPersistentlyHighlighted =
      uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id;
    if (!isPersistentlyHighlighted) {
      unhighlightProjectShapes(project.id);
    }
  });

  // Add tooltip to show project status in edit/moderation modes
  updateStandaloneProjectMarkerTooltip(marker, project, mapStore.mode);

  marker.on("click", (e) => {
    void (async () => {
      L.DomEvent.stopPropagation(e);
      const uiStore = useUiStore();

      // Check if popup is already open for this project - toggle behavior
      if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
        uiStore.closeProjectInfoPopup();
        updateStandaloneProjectMarkerOpacities(null);
        return;
      }

      // Open or update project info popup first to ensure state is set (prevents race conditions with SideMenu watcher)
      uiStore.openProjectInfoPopup(project.id, project);

      // Force switch to Current Location tab if user is exploring Latest tab
      if (uiStore.activeTab === "latest") {
        uiStore.activeTab = "currentLocation";
      }

      // Request scroll to project after data is loaded and tab is switched
      requestScrollTo("project", project.id);

      // Close overlay popup if it's open (only one popup at a time)
      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }

      // Deselect any selected overlay (mutual exclusivity between overlay and standalone project selection)
      if (overlayStore.idSelectedOverlay) {
        selectOverlay(null);
      }

      // Create/update teleport target at marker position
      createProjectInfoTeleportTarget(marker);

      // Update marker opacities (make this one fully opaque)
      updateStandaloneProjectMarkerOpacities(marker);
    })();
  });
}

/**
 * Get the standalone project marker map (for external access)
 */
export function getStandaloneProjectMarkerMap(): Map<string, L.Marker> {
  return standaloneProjectMarkerMap;
}

/**
 * Update standalone project marker color for a specific project
 */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const mapStore = useMapStore();
  const markerColor = getProjectMarkerColor(project, mapStore.mode);
  const markerIcon = createStandaloneProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

/**
 * Close project popup and reset standalone project marker opacities
 * This extends the base cleanup with marker opacity reset specific to standalone markers
 */
export function closeProjectPopupAndResetMarkers() {
  cleanupProjectInfoTeleportTarget();
  updateStandaloneProjectMarkerOpacities(null); // Reset marker opacities when popup closes
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
