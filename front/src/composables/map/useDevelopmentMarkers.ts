// AI : Development marker management - extracted to avoid circular dependencies
import L from "leaflet";
import type { Project } from '@types';
import { map } from '@composables/core/useMap';
import { createBasicProjectIcon } from '@composables/map/useMarkers';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useUiStore } from '@stores/uiStore';
import { MARKER_OPACITY } from '@constants/markerConstants';
import { createProjectInfoTeleportTarget } from '@composables/map/useProjectPopupTeleport';

// AI : Layer group for development projects (development markers)
let developmentProjectsLayer: L.LayerGroup | null = null;

// AI : Map to store project ID to marker references for easy lookup
const developmentMarkerMap = new Map<string, L.Marker>();

// AI : Track the currently selected development marker (for opacity control)
let selectedDevelopmentMarker: L.Marker | null = null;

/**
 * AI : Get development marker by project ID
 */
export function getDevelopmentMarkerByProjectId(projectId: string): L.Marker | undefined {
  return developmentMarkerMap.get(projectId);
}

/**
 * AI : Remove development marker for a specific project
 * This is called when the first overlay is added to a development project
 */
export function removeDevelopmentMarkerForProject(projectId: string): void {
  const marker = developmentMarkerMap.get(projectId);
  if (!marker) return;

  // AI : Close project info popup if it's showing info for this project
  const uiStore = useUiStore();
  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId) {
    uiStore.closeProjectInfoPopup();
  }

  // AI : Remove marker from map
  if (developmentProjectsLayer && developmentProjectsLayer.hasLayer(marker)) {
    developmentProjectsLayer.removeLayer(marker);
  }

  // AI : Remove marker from map
  developmentMarkerMap.delete(projectId);
}

/**
 * AI : Get project marker color based on status, timeline, and mode
 */
function getProjectMarkerColor(project: Project, mode: 'view' | 'edit' | 'moderation'): 'yellow' | 'green' | 'grey' | 'orange' | 'red' {
  if (mode === 'moderation') {
    const status = project.status;
    if (status === 'pending') return 'yellow';
    if (status === 'approved') return 'green';
    return 'grey';
  }

  if (mode === 'edit') {
    const hasBeenModified = project.isModified ?? false;
    const status = project.status;

    if (hasBeenModified) return 'orange';
    if (status === 'pending') return 'yellow';
    if (status === 'rejected') return 'red';
    if (status === 'approved') return 'green';
    return 'red';
  }

  // AI : View mode uses timeline-based colors
  if (project.status === 'pending') {
    return 'yellow';
  }

  const { proposalDate, startDate, endDate } = project;

  if (proposalDate && !startDate) return 'yellow';
  if (!startDate) return 'yellow';

  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (start > now) return 'green';
  if (end && end <= now) return 'grey';
  return 'orange';
}

/**
 * AI : Update development marker opacities based on selected marker
 */
function updateDevelopmentMarkerOpacities(selectedMarker: L.Marker | null) {
  if (!developmentProjectsLayer) return;

  selectedDevelopmentMarker = selectedMarker;

  developmentProjectsLayer.eachLayer((marker) => {
    if (marker instanceof L.Marker) {
      if (selectedMarker && marker === selectedMarker) {
        marker.setOpacity(MARKER_OPACITY.development.hover);
      } else {
        marker.setOpacity(MARKER_OPACITY.development.default);
      }
    }
  });
}

/**
 * AI : Add development marker for a specific project
 * This is called when the last overlay is deleted from a project
 */
export function addDevelopmentMarkerForProject(project: Project): void {
  if (!map.value || !project.lat || !project.lng) return;

  // AI : Don't add if marker already exists
  if (developmentMarkerMap.has(project.id)) return;

  // AI : Ensure development layer exists
  if (!developmentProjectsLayer) {
    developmentProjectsLayer = L.layerGroup();
    developmentProjectsLayer.addTo(map.value);
  }

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createBasicProjectIcon(markerColor);

  // AI : Create marker with default opacity
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.development.default
  });

  // AI : Prevent double-click zoom on markers
  marker.on('dblclick', (e) => {
    L.DomEvent.stopPropagation(e);
  });

  // AI : Add mouseover event to increase marker opacity
  marker.on('mouseover', () => {
    marker.setOpacity(MARKER_OPACITY.development.hover);
  });

  // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
  marker.on('mouseout', () => {
    if (selectedDevelopmentMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.development.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.development.default);
    }
  });

  // AI : Add click handler for projects without overlays - show info popup
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    const uiStore = useUiStore();

    // AI : Check if popup is already open for this project - toggle behavior
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      updateDevelopmentMarkerOpacities(null);
      return;
    }

    // AI : Create teleport target at marker position (shared utility)
    createProjectInfoTeleportTarget(marker);

    // AI : Update marker opacities (make this one fully opaque)
    updateDevelopmentMarkerOpacities(marker);

    // AI : Use uiStore to show project info popup
    // AI : Close overlay popup if it's open (only one popup at a time)
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }
    uiStore.openProjectInfoPopup(project.id, project);
  });

  // AI : Store marker in map for easy lookup
  developmentMarkerMap.set(project.id, marker);

  // AI : Add marker to layer
  marker.addTo(developmentProjectsLayer);
}

/**
 * AI : Get the development projects layer (for external access)
 */
export function getDevelopmentProjectsLayer(): L.LayerGroup | null {
  return developmentProjectsLayer;
}

/**
 * AI : Set the development projects layer (for external management)
 */
export function setDevelopmentProjectsLayer(layer: L.LayerGroup | null): void {
  developmentProjectsLayer = layer;
}

/**
 * AI : Get the development marker map (for external access)
 */
export function getDevelopmentMarkerMap(): Map<string, L.Marker> {
  return developmentMarkerMap;
}

/**
 * AI : Get the selected development marker
 */
export function getSelectedDevelopmentMarker(): L.Marker | null {
  return selectedDevelopmentMarker;
}

/**
 * AI : Set the selected development marker
 */
export function setSelectedDevelopmentMarker(marker: L.Marker | null): void {
  selectedDevelopmentMarker = marker;
}
