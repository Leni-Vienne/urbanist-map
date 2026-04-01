// ============================================================================
// OVERLAY SELECTION - Selection and highlighting management for overlays
// ============================================================================
// This module handles overlay selection, deselection, and highlighting.
// Extracted from useOverlay.ts as the lowest-level module (no internal deps).
// ============================================================================

import type L from "leaflet";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { getMarker, getLayer } from "@/services/overlay/overlayRenderRegistry";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { applySelectionRing, clearSelectionRing } from "@/services/overlay/overlayStyle";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayObject } from "@/types/index";
import { getProjectMarkerColor } from "@/utils/markerColors";
import {
  markerColors,
  OVERLAY_OUTLINE_COLOR,
  getOverlayMarkerColor,
  createOverlayIcon,
} from "@/services/map/markers";
import { highlightProjectShapes, unhighlightProjectShapes } from "@/services/map/shapeRendering";
import { setOverlayDrivenHover } from "@/services/map/vectorHoverState";

// Guard to prevent recursive selectOverlay calls when library fires select event
let isSelectingOverlay = false;

/**
 * Resolve the hex color for an overlay's selection outline.
 * In edit mode, uses the overlay's own state color for consistency with the marker.
 * In other modes, uses the project's timeline color to identify project membership.
 */
function resolveProjectHexColor(overlayObject: OverlayObject): string {
  const mode = useMapStore().mode;
  if (mode === "edit") {
    return markerColors[getOverlayMarkerColor(overlayObject, mode)];
  }
  if (mode === "moderation") {
    const proj = overlayObject.project;
    if (!proj) return OVERLAY_OUTLINE_COLOR;
    const colorKey = getProjectMarkerColor(proj, mode);
    return markerColors[colorKey];
  }
  // View mode: always use the standard blue selection color.
  // The vector tile shapes already convey project status; the ring is purely a selection indicator.
  return OVERLAY_OUTLINE_COLOR;
}

/**
 * Clean up previously selected overlay
 */
function cleanupPreviousSelection(
  previouslySelected: OverlayObject,
  previouslySelectedId: string,
  newOverlayId: string | null,
): void {
  if (previouslySelectedId === newOverlayId) return;

  removeOverlayOutline(previouslySelected);

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

/**
 * Setup newly selected overlay with proper state and highlighting
 */
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
    highlightProjectOverlaysOnHover(newlySelected.projectId);
  }

  // Apply selection outline after image loads
  applyOutlineAfterImageLoad(newlySelected);
}

/**
 * Select overlay in Leaflet, waiting for DOM if needed
 */
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
 * Apply selection outline, waiting for image load if needed
 */
function applyOutlineAfterImageLoad(overlayObject: OverlayObject): void {
  const imgElement = getLayer(overlayObject.id)?.getElement();

  if (!(imgElement instanceof HTMLImageElement)) {
    // Fallback for non-image elements
    applySelectionOutline(overlayObject);
    return;
  }

  if (imgElement.complete && imgElement.naturalWidth > 0) {
    // Image is already loaded, apply outline immediately
    applySelectionOutline(overlayObject);
  } else {
    // Image not loaded yet, wait for load event
    imgElement.addEventListener(
      "load",
      () => {
        applySelectionOutline(overlayObject);
      },
      { once: true },
    );
  }
}

/**
 * Select an overlay with proper cleanup of previous selection
 * This ensures consistent selection behavior regardless of how selection is triggered
 */
export function selectOverlay(overlayId: string | null): void {
  // Prevent recursive calls (library's select event → selectOverlay → overlay.select → select event)
  if (isSelectingOverlay) return;

  const overlayStore = useOverlayStore();

  // Early exit if already selected
  if (overlayId === overlayStore.idSelectedOverlay) return;

  isSelectingOverlay = true;
  try {
    // Store previous selection info before updating
    const previouslySelectedId = overlayStore.idSelectedOverlay;
    const previouslySelected = previouslySelectedId
      ? overlayStore.overlays[previouslySelectedId]
      : null;

    // Update selected overlay ID
    overlayStore.idSelectedOverlay = overlayId;

    // Clean up previous selection if different from new selection
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

export function applySelectionOutline(overlayObject: OverlayObject): void {
  const selLayer = getLayer(overlayObject.id);
  if (!selLayer) return;

  const element = selLayer.getElement();
  if (element) {
    applySelectionRing(element, resolveProjectHexColor(overlayObject));
  }
}

/**
 * Remove outline from a single overlay
 */
function removeOverlayOutline(overlayObject: OverlayObject): void {
  const removeLayer = getLayer(overlayObject.id);
  if (!removeLayer) return;

  const element = removeLayer.getElement();
  if (element) {
    clearSelectionRing(element);
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

  // Don't remove outlines if an overlay in this project is selected or the project popup is open (unless forced)
  if (!force) {
    const selectedOverlay = overlayStore.idSelectedOverlay
      ? overlayStore.overlays[overlayStore.idSelectedOverlay]
      : null;
    if (selectedOverlay?.projectId === projectId) return;

    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === projectId)
      return;
  }

  // Remove all outlines from overlays in this project
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    if (overlayObject.projectId === projectId) {
      removeOverlayOutline(overlayObject);
    }
  }

  // Unhighlight project shapes alongside the overlays (Leaflet layers in edit/moderation, vector tiles in view mode)
  unhighlightProjectShapes(projectId);
  setOverlayDrivenHover(null);
}

/**
 * Apply the project highlight ring to a single overlay element.
 * Use this when only one overlay needs styling (e.g. on load) to avoid the O(N)
 * store loop inside highlightProjectOverlaysOnHover.
 * Shapes are intentionally NOT restyles here — they are already highlighted.
 */
export function applyProjectHighlightToElement(
  element: HTMLElement,
  overlayObject: OverlayObject,
): void {
  applySelectionRing(element, resolveProjectHexColor(overlayObject));
}

/**
 * Highlight all overlays (and shapes) from the same project on hover/select.
 * Each overlay uses its own state color so pending overlays keep their yellow
 * outline while approved overlays show green — even when hovered together.
 */
/**
 * Highlight all overlays (and shapes) from the same project on hover.
 *
 * Two intentionally different strategies depending on mode -- both live here
 * so there is one place to maintain:
 *
 * VIEW MODE: drive the MapLibre vector footprint highlight via setOverlayDrivenHover.
 *   The footprint polygon already carries the project tag color, so no extra color
 *   resolution is needed.  CSS rings are skipped because the tag color is not
 *   available on the OverlayObject in view mode without a separate lookup.
 *
 * EDIT / MODERATION: apply CSS rings colored by modification/approval state.
 *   The blue MapLibre highlight is skipped because it conflicts with the
 *   yellow/orange/green status colors of the rings.
 */
export function highlightProjectOverlaysOnHover(projectId: string): void {
  if (!projectId) return;

  const mode = useMapStore().mode;

  if (mode === "view") {
    setOverlayDrivenHover(projectId);
  } else {
    const overlayStore = useOverlayStore();
    for (const overlayObject of Object.values(overlayStore.overlays)) {
      if (!overlayObject.projectId) continue;

      const hoverLayer = getLayer(overlayObject.id);
      if (!hoverLayer) continue;

      const element = hoverLayer.getElement();
      if (element) {
        applySelectionRing(element, resolveProjectHexColor(overlayObject));
      }
    }
  }

  // Leaflet shape layers (standalone project geometry) exist in all modes
  highlightProjectShapes(projectId);
}

/**
 * Returns the projectId that is currently "highlighted" — either because an overlay of
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
 *
 * In view mode this is intentionally a no-op: the Leaflet overlay image uses a
 * matrix3d CSS transform whose pre-transform layout box does not match the visual
 * polygon, so mouseenter only fires at certain edges.  Instead, the MapLibre
 * mousemove handler drives view-mode hover via the overlay-footprints vector layer,
 * which correctly bounds the visual shape.
 */
export function setupProjectHoverEvents(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  if (!overlayObject.projectId) return;

  const element = overlay.getElement();
  if (!element) return;

  element.addEventListener("mouseenter", () => {
    if (useMapStore().mode === "view") return;
    if (overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  element.addEventListener("mouseleave", () => {
    if (useMapStore().mode === "view") return;
    if (overlayObject.projectId) {
      removeProjectOutlines(overlayObject.projectId);
    }
  });
}

/**
 * Ensure the currently selected overlay stays on top of all other overlays.
 * Call this after adding new overlays to the map to maintain selection z-index priority.
 */
export function ensureSelectedOverlayOnTop(): void {
  const overlayStore = useOverlayStore();
  if (!overlayStore.idSelectedOverlay) return;

  const selectedLayer = getLayer(overlayStore.idSelectedOverlay);
  if (selectedLayer) {
    selectedLayer.bringToFront();
  }
}

/**
 * Setup map click handler to deselect overlays when clicking the map background
 */
export function setupMapClickToDeselect(): void {
  map.value.on("click", () => {
    const overlayStore = useOverlayStore();
    // Deselect if currently selected - overlay click handlers will re-select if clicked
    if (overlayStore.idSelectedOverlay) {
      selectOverlay(null);
    }
  });
}
