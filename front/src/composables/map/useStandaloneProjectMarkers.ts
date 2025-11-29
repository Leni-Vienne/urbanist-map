// AI : Standalone project marker management - extracted to avoid circular dependencies
import L from "leaflet";
import type { Project } from '@types';
import { map } from '@composables/core/useMap';
import { createBasicProjectIcon } from '@composables/map/useMarkers';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useUiStore } from '@stores/uiStore';
import { MARKER_OPACITY } from '@constants/markerConstants';
import { createProjectInfoTeleportTarget } from '@composables/map/useProjectPopupTeleport';
import { getProjectMarkerColor } from '../../utils/markerColors';

// AI : Layer group for standalone projects (standalone project markers)
let standaloneProjectsLayer: L.LayerGroup | null = null;

// AI : Map to store project ID to marker references for easy lookup
const standaloneProjectMarkerMap = new Map<string, L.Marker>();

// AI : Track the currently selected standalone project marker (for opacity control)
let selectedStandaloneProjectMarker: L.Marker | null = null;

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

  // AI : Ensure standalone project layer exists
  if (!standaloneProjectsLayer) {
    standaloneProjectsLayer = L.layerGroup();
    standaloneProjectsLayer.addTo(map.value);
  }

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createBasicProjectIcon(markerColor);

  // AI : Create marker with default opacity
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.standalone.default
  });

  // AI : Prevent double-click zoom on markers
  marker.on('dblclick', (e) => {
    L.DomEvent.stopPropagation(e);
  });

  // AI : Add mouseover event to increase marker opacity
  marker.on('mouseover', () => {
    marker.setOpacity(MARKER_OPACITY.standalone.hover);
  });

  // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
  marker.on('mouseout', () => {
    if (selectedStandaloneProjectMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.standalone.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.standalone.default);
    }
  });

  // AI : Add click handler for projects without overlays - show info popup
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    const uiStore = useUiStore();

    // AI : Check if popup is already open for this project - toggle behavior
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      updateStandaloneProjectMarkerOpacities(null);
      return;
    }

    // AI : Create teleport target at marker position (shared utility)
    createProjectInfoTeleportTarget(marker);

    // AI : Update marker opacities (make this one fully opaque)
    updateStandaloneProjectMarkerOpacities(marker);

    // AI : Use uiStore to show project info popup
    // AI : Close overlay popup if it's open (only one popup at a time)
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }
    uiStore.openProjectInfoPopup(project.id, project);
  });

  // AI : Store marker in map for easy lookup
  standaloneProjectMarkerMap.set(project.id, marker);

  // AI : Add marker to layer
  marker.addTo(standaloneProjectsLayer);
}

/**
 * AI : Get the standalone projects layer (for external access)
 */
export function getStandaloneProjectsLayer(): L.LayerGroup | null {
  return standaloneProjectsLayer;
}

/**
 * AI : Set the standalone projects layer (for external management)
 */
export function setStandaloneProjectsLayer(layer: L.LayerGroup | null): void {
  standaloneProjectsLayer = layer;
}

/**
 * AI : Get the standalone project marker map (for external access)
 */
export function getStandaloneProjectMarkerMap(): Map<string, L.Marker> {
  return standaloneProjectMarkerMap;
}

/**
 * AI : Get the selected standalone project marker
 */
export function getSelectedStandaloneProjectMarker(): L.Marker | null {
  return selectedStandaloneProjectMarker;
}

/**
 * AI : Set the selected standalone project marker
 */
export function setSelectedStandaloneProjectMarker(marker: L.Marker | null): void {
  selectedStandaloneProjectMarker = marker;
}
