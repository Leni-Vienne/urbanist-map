import type L from "leaflet";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { getMarker, getLayer } from "@/services/overlay/overlayRenderRegistry";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayObject } from "@/types/index";
import { getOverlayMarkerColor, createOverlayIcon } from "@/services/map/markers";
import { highlightProjectShapes, unhighlightProjectShapes } from "@/services/map/shapeRendering";
import { setOverlayDrivenHover } from "@/services/map/vectorHoverState";

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

  // Call deselect on the Leaflet overlay to remove toolbar and handles
  const prevLayer = getLayer(previouslySelected.id);
  if (prevLayer) {
    prevLayer.deselect();
  }
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
    marker.setIcon(createOverlayIcon(getOverlayMarkerColor(newlySelected, mode)));
  }

  // Sync preview state for reactive button highlighting in change request UI
  syncPreviewStateOnNavigation(overlayId, newlySelected.isViewingApprovedPosition);

  // Call overlay.select() to show toolbar and handles (single source of truth)
  const newLayer = getLayer(newlySelected.id);
  if (newLayer) {
    selectOverlayInLeaflet(newLayer);
    // Bring selected overlay to front so it stays on top of overlapping images
    newLayer.bringToFront();
  }

  // Apply project highlights (sister overlays) when selecting
  if (newlySelected.projectId) {
    highlightProjectOverlaysOnHover(newlySelected.projectId, newlySelected.id);
  }
}

function selectOverlayInLeaflet(overlay: L.DistortableImageOverlay): void {
  const element = overlay.getElement();
  const isInDOM = element && document.body.contains(element);

  if (!isInDOM) {
    // Wait for element to be added to DOM before selecting
    requestAnimationFrame(() => {
      overlay.select();
    });
  } else {
    overlay.select();
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

  setOverlayDrivenHover(null);
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
 * Highlight all overlays (and shapes) from the same project on hover.
 */
export function highlightProjectOverlaysOnHover(projectId: string, overlayId?: string): void {
  if (!projectId) return;

  setOverlayDrivenHover(projectId, overlayId ?? null);

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
    highlightProjectOverlaysOnHover(projectId);
  }
}

/**
 * Setup hover event listeners for project highlighting in edit/moderation mode.
 */
export function setupProjectHoverEvents(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  if (!overlayObject.projectId) return;

  const element = overlay.getElement();
  if (!element) return;

  element.addEventListener("mouseenter", () => {
    if (overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId, overlayObject.id);
    }
  });

  element.addEventListener("mouseleave", () => {
    if (overlayObject.projectId) {
      removeProjectOutlines(overlayObject.projectId);
    }
  });
}

/**
 * Setup map click handler to deselect overlays when clicking the map background
 */
export function setupMapClickToDeselect(): void {
  map.value.on("click", () => {
    const overlayStore = useOverlayStore();
    if (overlayStore.idSelectedOverlay) {
      selectOverlay(null);
    }
  });
}
