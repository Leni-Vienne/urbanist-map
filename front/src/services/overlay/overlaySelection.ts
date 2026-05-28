import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { getMarker, getRenderedOverlayIds } from "@/services/overlay/overlayRenderRegistry";
import { showEditHandles, hideEditHandles } from "@/services/overlay/overlayEditHandles";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayObject } from "@/types/index";
import { getOverlayMarkerColor, updateOverlayMarkerColor } from "@/services/map/markers";
import {
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeLayerRegistry";
import { setExternalHover } from "@/services/map/vectorHoverState";

type Corner = { lat: number; lng: number };

// Guard to prevent recursive selectOverlay calls when library fires select event
let isSelectingOverlay = false;

function cleanupPreviousSelection(
  previouslySelected: OverlayObject,
  previouslySelectedId: string,
  newOverlayId: string | null,
): void {
  if (previouslySelectedId === newOverlayId) return;

  // Remove project outlines (sister highlights) when deselecting
  if (previouslySelected.projectId) {
    removeProjectOutlines(previouslySelected.projectId, true);
  }

  // Remove editing handles from the previously selected overlay.
  hideEditHandles();
}

function setupNewSelection(newlySelected: OverlayObject, overlayId: string): void {
  // Set position state for dynamic button feedback when selecting overlay
  // Default to viewing the approved position on first selection
  if (newlySelected.isViewingApprovedPosition === undefined) {
    newlySelected.isViewingApprovedPosition = true;
  }

  // Update marker icon to reflect isViewingApprovedPosition (may have just changed from undefined)
  const marker = getMarker(overlayId);
  if (marker) {
    const mode = useMapStore().mode;
    updateOverlayMarkerColor(marker, getOverlayMarkerColor(newlySelected, mode));
  }

  // Sync preview state for reactive button highlighting in change request UI
  syncPreviewStateOnNavigation(overlayId, newlySelected.isViewingApprovedPosition);

  // Show editing handles when selecting in edit mode.
  if (useMapStore().mode === "edit") {
    showEditHandles(newlySelected);
  }

  // Apply project highlights (sister overlays) when selecting
  if (newlySelected.projectId) {
    highlightProject(newlySelected.projectId, newlySelected.id);
  }
}

/**
 * Select an overlay with proper cleanup of previous selection
 * This ensures consistent selection behavior regardless of how selection is triggered
 */
export function selectOverlay(overlayId: string | null): void {
  // Prevent recursive calls (library's select event -> selectOverlay -> overlay.select -> select event)
  if (isSelectingOverlay) return;

  const overlayStore = useOverlayStore();

  // Early exit if already selected
  if (overlayId === overlayStore.idSelectedOverlay) return;

  isSelectingOverlay = true;
  try {
    const previouslySelectedId = overlayStore.idSelectedOverlay;
    const previouslySelected = previouslySelectedId
      ? overlayStore.overlays[previouslySelectedId]
      : null;

    overlayStore.idSelectedOverlay = overlayId;

    if (previouslySelected && previouslySelectedId) {
      cleanupPreviousSelection(previouslySelected, previouslySelectedId, overlayId);
    }

    if (!overlayId) return;

    // Close standalone project popup when selecting an overlay (mutual exclusivity)
    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible) {
      uiStore.closeProjectInfoPopup();
    }

    // Apply selection to new overlay
    const newlySelected = overlayStore.overlays[overlayId];
    if (!newlySelected) return;

    setupNewSelection(newlySelected, overlayId);

    // Request scroll to overlay in accordion panel when selecting from map
    requestScrollTo("overlay", overlayId);
  } finally {
    isSelectingOverlay = false;
  }
}

/**
 * Highlight a single overlay by ID - used for hover from side menu
 * Scales up the marker if it exists (visible even when zoomed out)
 */
export function highlightOverlayById(overlayId: string): void {
  // Scale up the marker for visibility at any zoom level
  const marker = getMarker(overlayId);
  if (marker) {
    const markerElement = marker.getElement();
    if (markerElement) {
      // Scale the SVG inside the marker to avoid interfering with Leaflet's translate3d positioning
      const svg = markerElement.querySelector("svg");
      if (svg) {
        svg.style.transformOrigin = "center bottom";
        svg.style.transition = "transform 0.15s ease";
        svg.style.transform = "scale(1.5)";
      }
      markerElement.style.zIndex = "1000";
    }
  }
}

/**
 * Remove highlight from a single overlay by ID - used for hover leave from side menu
 */
export function removeOverlayHighlight(overlayId: string): void {
  // Reset marker scale
  const marker = getMarker(overlayId);
  if (marker) {
    const markerElement = marker.getElement();
    if (markerElement) {
      const svg = markerElement.querySelector("svg");
      if (svg) {
        svg.style.transform = "";
      }
      markerElement.style.zIndex = "";
    }
  }
}

/**
 * Remove outlines from all overlays in a project
 * @param projectId - The project whose overlays should have outlines removed
 * @param force - If true, removes outlines even if an overlay in the project is selected
 */
export function removeProjectOutlines(projectId: string, force = false): void {
  const overlayStore = useOverlayStore();

  if (!projectId) return;

  setExternalHover(null);
  if (!force) {
    const selectedOverlay = overlayStore.idSelectedOverlay
      ? overlayStore.overlays[overlayStore.idSelectedOverlay]
      : null;
    if (selectedOverlay?.projectId === projectId) return;

    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId)
      return;
  }

  // Unhighlight project shapes alongside the overlays (Leaflet layers in edit/moderation, vector tiles in view mode)
  unhighlightProjectShapes(projectId);
  refreshSelectionHighlight();
}

/**
 * Highlight everything related to a project: Leaflet shapes, sister overlays, and the
 * vector tile filters (via the external-hover state). Called from sidebar hover,
 * overlay DOM hover, overlay selection, and selection refresh after mode switch.
 */
export function highlightProject(projectId: string, overlayId?: string): void {
  if (!projectId) return;

  setExternalHover(projectId, overlayId ?? null);

  // Leaflet shape layers (standalone project geometry) exist in all modes
  highlightProjectShapes(projectId);
}

/**
 * Returns the projectId that is currently "highlighted" - either because an overlay of
 * that project is selected, or because the project info popup (shape click) is open.
 */
export function getCurrentHighlightedProjectId(): string | null {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();

  const selected = overlayStore.idSelectedOverlay
    ? overlayStore.overlays[overlayStore.idSelectedOverlay]
    : null;
  return (
    selected?.projectId ??
    (uiStore.projectInfoPopup.visible ? uiStore.projectInfoPopup.projectId : null)
  );
}

/**
 * Re-apply the highlight (overlays + shapes) for the currently highlighted project.
 * Call after mode switches so that persisting overlay elements get the correct new-mode color.
 */
export function refreshSelectionHighlight(): void {
  const projectId = getCurrentHighlightedProjectId();
  if (projectId) {
    highlightProject(projectId);
  }
}

function isPointInCorners(point: { lat: number; lng: number }, corners: Corner[]): boolean {
  if (corners.length < 3) return false;
  let isInside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i];
    const b = corners[j];
    if (!a || !b) continue;
    const intersect =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

/**
 * Map click fallthrough: no vector/point feature was hit. Select an unapproved overlay
 * whose footprint contains the click (approved overlays go through the vector tile path),
 * otherwise deselect.
 */
export function handleBackgroundClick(lngLat: { lng: number; lat: number }): void {
  const overlayStore = useOverlayStore();
  const renderedIds = getRenderedOverlayIds();

  // Search in reverse order to prefer overlays rendered on top
  for (let i = renderedIds.length - 1; i >= 0; i -= 1) {
    const id = renderedIds[i];
    if (!id) continue;
    const overlay = overlayStore.overlays[id];
    if (overlay && overlay.status !== "approved" && overlay.corners.length === 4) {
      if (isPointInCorners(lngLat, overlay.corners)) {
        selectOverlay(id);
        return;
      }
    }
  }

  if (overlayStore.idSelectedOverlay) {
    selectOverlay(null);
  }
}
