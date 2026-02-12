import L from "leaflet";
import { watch } from "vue";
import type { Project } from "@/types/index";
import { map } from "@/services/core/map";
import { createStandaloneProjectIcon } from "@/services/map/markers";
import { visibleCompletionStates } from "@/services/overlay/completionFilters";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { trpc } from "@/client";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import {
  createProjectInfoTeleportTarget,
  cleanupProjectInfoTeleportTarget,
} from "@/services/map/projectPopupTeleport";
import { requestScrollTo } from "@/services/layout/accordionState";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { fetchCityStandaloneProjectsOrCache } from "@/services/navigation/cityDataLoader";
// AI : useI18n() uses Vue's inject() mechanism which is only available synchronously during the setup() phase of a component.
import { t } from "@/locales";

// AI : Layer group for standalone projects (standalone project markers)
let standaloneProjectsLayer: L.LayerGroup | null = null;

// AI : Map to store project ID to marker references for easy lookup
const standaloneProjectMarkerMap = new Map<string, L.Marker>();

// AI : Track the currently selected standalone project marker (for opacity control)
let selectedStandaloneProjectMarker: L.Marker | null = null;

// AI : Track if watcher has been initialized (lazy initialization to avoid Pinia issues)
let isWatcherInitialized = false;

/**
 * AI : Initialize watchers for standalone markers (lazy initialization)
 * Called once when first marker is added to avoid Pinia initialization issues
 */
function initializePopupWatcher() {
  if (isWatcherInitialized) return;

  const uiStore = useUiStore();
  watch(
    () => uiStore.projectInfoPopup.visible,
    (isVisible, wasVisible) => {
      // AI : When popup closes, reset marker opacity
      if (wasVisible && !isVisible) {
        updateStandaloneProjectMarkerOpacities(null);
      }
    },
  );

  // AI : Watch completion filter changes and refresh all standalone markers
  watch(
    () => visibleCompletionStates.value,
    () => {
      refreshAllStandaloneMarkers();
    },
    { deep: true },
  );

  isWatcherInitialized = true;
}

/**
 * AI : Get standalone project marker by project ID
 */
export function getStandaloneProjectMarkerByProjectId(projectId: string): L.Marker | undefined {
  return standaloneProjectMarkerMap.get(projectId);
}

/**
 * AI : Remove standalone project marker for a specific project
 * This is called when the first overlay is added to a standalone project
 */
export function removeStandaloneProjectMarkerForProject(projectId: string): void {
  const marker = standaloneProjectMarkerMap.get(projectId);
  if (!marker) return;

  // AI : Close project info popup if it's showing info for this project
  const uiStore = useUiStore();
  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
    uiStore.closeProjectInfoPopup();
  }

  // AI : Remove marker from map
  if (standaloneProjectsLayer?.hasLayer(marker)) {
    standaloneProjectsLayer.removeLayer(marker);
  }

  // AI : Remove marker from map
  standaloneProjectMarkerMap.delete(projectId);
}

/**
 * AI : Clear all standalone project markers from the map
 * This is called when switching cities to prevent marker accumulation
 */
export function clearAllStandaloneProjectMarkers(): void {
  // AI : Properly remove all markers and their event listeners
  for (const marker of standaloneProjectMarkerMap.values()) {
    if (marker) {
      // AI : Remove all event listeners before removing from map
      marker.off();
      // AI : Remove from layer if it exists
      if (standaloneProjectsLayer?.hasLayer(marker)) {
        standaloneProjectsLayer.removeLayer(marker);
      }
    }
  }

  // AI : Now remove the layer from map
  if (standaloneProjectsLayer && map.value) {
    map.value.removeLayer(standaloneProjectsLayer);
    standaloneProjectsLayer = null;
  }

  standaloneProjectMarkerMap.clear();
  selectedStandaloneProjectMarker = null;
}

/**
 * AI : Refresh all standalone markers visibility based on current completion filters
 * This is called when completion filters change
 */
function refreshAllStandaloneMarkers(): void {
  if (!standaloneProjectsLayer) return;

  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // AI : Iterate through all existing markers
  for (const [projectId, marker] of standaloneProjectMarkerMap.entries()) {
    const project = projectStore.projects[projectId];
    if (!project) continue;

    // AI : Get marker color for this project
    const markerColor = getProjectMarkerColor(project, overlayStore.mode);

    // AI : Check if this marker should be visible
    const shouldBeVisible = visibleCompletionStates.value[markerColor];

    // AI : Show or hide the marker based on filter
    if (shouldBeVisible) {
      // AI : Add to layer if not already there
      if (!standaloneProjectsLayer.hasLayer(marker)) {
        standaloneProjectsLayer.addLayer(marker);
      }
    } else {
      // AI : Remove from layer if it's there
      if (standaloneProjectsLayer.hasLayer(marker)) {
        standaloneProjectsLayer.removeLayer(marker);
      }
    }
  }
}

/**
 * AI : Update standalone project marker tooltip based on project status
 * AI : Only shows tooltips in edit and moderation modes (similar to overlay markers)
 * @param marker - The marker to update
 * @param project - The project data
 * @param mode - Current map mode
 */
export function updateStandaloneProjectMarkerTooltip(
  marker: L.Marker,
  project: Project,
  mode: "view" | "edit" | "moderation",
): void {
  // AI : Only show tooltips in edit and moderation modes (view mode doesn't need them)
  if (mode === "view") {
    if (marker.getTooltip()) {
      marker.unbindTooltip();
    }
    return;
  }

  let tooltipText = "";
  let modifierText = "";

  if (mode === "moderation") {
    // AI : Moderation mode: Show approval status
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
    // AI : Edit mode: Show status with modified state
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

  // AI : Assemble final tooltip text with modifier in parentheses if present
  const finalTooltipText = modifierText ? `${tooltipText} (${modifierText})` : tooltipText;

  // AI : Update tooltip content if it exists, otherwise bind new one
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
 * AI : Update standalone project marker opacities based on selected marker
 */
export function updateStandaloneProjectMarkerOpacities(selectedMarker: L.Marker | null) {
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
 * AI : Add standalone project marker for a specific project
 * This is called when the last overlay is deleted from a project
 */
export function addStandaloneProjectMarkerForProject(project: Project): void {
  if (!map.value || !project.lat || !project.lng) return;

  // AI : Don't add if marker already exists
  if (standaloneProjectMarkerMap.has(project.id)) return;

  // AI : Initialize popup watcher on first marker addition (lazy initialization)
  initializePopupWatcher();

  // AI : Get marker color and check if it should be visible based on current filter
  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const shouldBeVisible = visibleCompletionStates.value[markerColor];

  // AI : Ensure standalone project layer exists
  if (!standaloneProjectsLayer) {
    standaloneProjectsLayer = L.layerGroup();
    standaloneProjectsLayer.addTo(map.value);
  }

  // AI : CRITICAL: Store project in projectStore so it can be found later for color updates
  // AI : This is necessary for viewport-loaded markers where projects aren't loaded via loadCityStandaloneProjects
  const projectStore = useProjectStore();
  if (!projectStore.projects[project.id]) {
    projectStore.projects = {
      ...projectStore.projects,
      [project.id]: project,
    };
  }

  const markerIcon = createStandaloneProjectIcon(markerColor);

  // AI : Create marker
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.standalone.default,
  });

  // AI : Store marker in map BEFORE adding to layer (so refresh function can find it)
  standaloneProjectMarkerMap.set(project.id, marker);

  // AI : Only add to layer if it passes the completion filter
  if (shouldBeVisible) {
    standaloneProjectsLayer.addLayer(marker);
  }

  // AI : Prevent double-click zoom on markers
  marker.on("dblclick", (e) => {
    L.DomEvent.stopPropagation(e);
  });

  // AI : Add mouseover event to increase marker opacity
  marker.on("mouseover", () => {
    marker.setOpacity(MARKER_OPACITY.standalone.hover);
  });

  // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
  marker.on("mouseout", () => {
    if (selectedStandaloneProjectMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.standalone.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.standalone.default);
    }
  });

  // AI : Add tooltip to show project status in edit/moderation modes
  updateStandaloneProjectMarkerTooltip(marker, project, overlayStore.mode);

  marker.on("click", async (e) => {
    L.DomEvent.stopPropagation(e);
    const uiStore = useUiStore();

    // AI : In moderation mode, clicking a contribution should load the city context
    if (overlayStore.mode === "moderation" && project.city) {
      const mapStore = useMapStore();
      if (mapStore.selectedCity?.id !== project.city.id) {
        mapStore.setSelectedCity({
          id: project.city.id,
          name: project.city.name,
          nameLocal: project.city.nameLocal,
          countryCode: project.city.countryCode,
        });
      }
    }

    // AI : Check if popup is already open for this project - toggle behavior
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      updateStandaloneProjectMarkerOpacities(null);
      return;
    }

    // AI : Open or update project info popup first to ensure state is set (prevents race conditions with SideMenu watcher)
    uiStore.openProjectInfoPopup(project.id, project);
    // AI : Ensure city context and data are loaded for the panel
    if (project.city) {
      const mapStore = useMapStore();
      const mode = overlayStore.mode;

      // AI : Set city if not already selected (required for currentLocation panel to show data)
      if (mapStore.selectedCity?.id !== project.city.id) {
        mapStore.setSelectedCity({
          id: project.city.id,
          name: project.city.name,
          nameLocal: project.city.nameLocal,
          countryCode: project.city.countryCode,
        });
      }

      // AI : Ensure data is loaded for the panel to work (overlays AND standalone projects)
      const promises = [];

      if (!mapStore.hasCityProjectsCache(project.city.id, mode)) {
        promises.push(
          trpc.cities.getCityOverlaysAndProjects
            .query({
              cityId: project.city.id,
              mode,
            })
            .then((data) => {
              if (data) mapStore.setCityProjectsCache(project.city.id, mode, data);
            }),
        );
      }

      if (!mapStore.hasCityStandaloneProjectsCache(project.city.id, mode)) {
        promises.push(
          fetchCityStandaloneProjectsOrCache(project.city.id, mode).catch(console.error),
        );
      }

      // AI : Wait for data to be ready
      await Promise.all(promises).catch(console.error);

      // AI : Force switch to Current Location tab if user is exploring Latest tab
      if (uiStore.activeTab === "latest") {
        uiStore.setActiveTab("currentLocation");
      }

      // AI : Request scroll to project after data is loaded and tab is switched
      requestScrollTo("project", project.id);
    }

    // AI : Close overlay popup if it's open (only one popup at a time)
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }

    // AI : Deselect any selected overlay (mutual exclusivity between overlay and standalone project selection)
    if (overlayStore.idSelectedOverlay) {
      selectOverlay(null);
    }

    // AI : Create/update teleport target at marker position
    createProjectInfoTeleportTarget(marker);

    // AI : Update marker opacities (make this one fully opaque)
    updateStandaloneProjectMarkerOpacities(marker);
  });

  // AI : Store marker in map for easy lookup
  standaloneProjectMarkerMap.set(project.id, marker);

  // AI : Add marker to layer
  marker.addTo(standaloneProjectsLayer);
}

/**
 * AI : Get the standalone project marker map (for external access)
 */
export function getStandaloneProjectMarkerMap(): Map<string, L.Marker> {
  return standaloneProjectMarkerMap;
}

/**
 * AI : Update standalone project marker color for a specific project
 */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createStandaloneProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

/**
 * AI : Close project popup and reset standalone project marker opacities
 * This extends the base cleanup with marker opacity reset specific to standalone markers
 */
export function closeProjectPopupAndResetMarkers() {
  cleanupProjectInfoTeleportTarget();
  updateStandaloneProjectMarkerOpacities(null); // AI : Reset marker opacities when popup closes
}
