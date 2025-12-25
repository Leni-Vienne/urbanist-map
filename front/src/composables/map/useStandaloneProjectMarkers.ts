// AI : Standalone project marker management - extracted to avoid circular dependencies
import L from "leaflet";
import { watch } from "vue";
import type { Project } from "@/types/index";
import { map } from "@/composables/core/useMap";
import { createStandaloneProjectIcon } from "@/composables/map/useMarkers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createProjectInfoTeleportTarget } from "@/composables/map/useProjectPopupTeleport";
import { getProjectMarkerColor } from "../../utils/markerColors";
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
 * AI : Initialize watcher for project info popup closing (lazy initialization)
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
  if (standaloneProjectsLayer && map.value) {
    map.value.removeLayer(standaloneProjectsLayer);
    standaloneProjectsLayer = null;
  }
  standaloneProjectMarkerMap.clear();
  selectedStandaloneProjectMarker = null;
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
  // AI : Remove any existing tooltip
  marker.unbindTooltip();

  // AI : Only show tooltips in edit and moderation modes (view mode doesn't need them)
  if (mode === "view") {
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
        tooltipText = t("markerTooltip.project.approved");
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
      tooltipText = t("markerTooltip.project.approved");
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

  marker.bindTooltip(finalTooltipText, {
    permanent: false,
    direction: "top",
    offset: [0, -10],
  });
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

  // AI : Ensure standalone project layer exists
  if (!standaloneProjectsLayer) {
    standaloneProjectsLayer = L.layerGroup();
    standaloneProjectsLayer.addTo(map.value);
  }

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createStandaloneProjectIcon(markerColor);

  // AI : Create marker with default opacity
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.standalone.default,
  });

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

  // AI : Add click handler for projects without overlays - show info popup
  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    const uiStore = useUiStore();

    // AI : Check if popup is already open for this project - toggle behavior
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      updateStandaloneProjectMarkerOpacities(null);
      return;
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

    // AI : Open or update project info popup (openProjectInfoPopup handles both cases)
    uiStore.openProjectInfoPopup(project.id, project);
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
