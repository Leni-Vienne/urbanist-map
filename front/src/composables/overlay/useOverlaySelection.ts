// AI : ============================================================================
// AI : OVERLAY SELECTION - Selection and highlighting management for overlays
// AI : ============================================================================
// AI : This module handles overlay selection, deselection, and highlighting.
// AI : Extracted from useOverlay.ts as the lowest-level module (no internal deps).
// AI : ============================================================================

import type L from 'leaflet';
import { map } from '@/composables/core/useMap';
import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { OVERLAY_OUTLINE_COLOR } from '@/composables/map/useMarkers';
import { syncPreviewStateOnNavigation } from '@/composables/overlay/changeRequestPreviewState';
import type { OverlayObject } from '@/types/index';

// AI : Guard to prevent recursive selectOverlay calls when library fires select event
let isSelectingOverlay = false;

/**
 * AI : Clean up previously selected overlay
 */
function cleanupPreviousSelection(previouslySelected: OverlayObject, previouslySelectedId: string, newOverlayId: string | null): void {
  if (!previouslySelected || previouslySelectedId === newOverlayId) return;

  removeOverlayOutline(previouslySelected);

  // AI : Remove project outlines (sister highlights) when deselecting
  if (previouslySelected.projectId) {
    removeProjectOutlines(previouslySelected.projectId, true);
  }

  // AI : Call deselect on the Leaflet overlay to remove toolbar and handles
  if (previouslySelected.overlay) {
    previouslySelected.overlay.deselect();
  }
}

/**
 * AI : Setup newly selected overlay with proper state and highlighting
 */
function setupNewSelection(newlySelected: OverlayObject, overlayId: string): void {
  // AI : Set position state for dynamic button feedback when selecting overlay
  // AI : If no explicit position state, default to showing approved position

 newlySelected.isViewingApprovedPosition ??= true;

  // AI : Sync preview state for reactive button highlighting in change request UI
  syncPreviewStateOnNavigation(overlayId, newlySelected.isViewingApprovedPosition ?? true);

  // AI : Call overlay.select() to show toolbar and handles (single source of truth)
  if (newlySelected.overlay) {
    selectOverlayInLeaflet(newlySelected.overlay);
  }

  // AI : Apply project highlights (sister overlays) when selecting
  if (newlySelected.projectId) {
    highlightProjectOverlaysOnHover(newlySelected.projectId);
  }

  // AI : Apply selection outline after image loads
  applyOutlineAfterImageLoad(newlySelected);
}

/**
 * AI : Select overlay in Leaflet, waiting for DOM if needed
 */
function selectOverlayInLeaflet(overlay: L.DistortableImageOverlay): void {
  const element = overlay.getElement();
  const isInDOM = element && document.body.contains(element);

  if (!isInDOM) {
    // AI : Wait for element to be added to DOM before selecting
    requestAnimationFrame(() => {
      overlay.select();
    });
  } else {
    overlay.select();
  }
}

/**
 * AI : Apply selection outline, waiting for image load if needed
 */
function applyOutlineAfterImageLoad(overlayObject: OverlayObject): void {
  const imgElement = overlayObject.overlay?.getElement();
  
  if (!(imgElement instanceof HTMLImageElement)) {
    // AI : Fallback for non-image elements
    applySelectionOutline(overlayObject);
    return;
  }

  if (imgElement.complete && imgElement.naturalWidth > 0) {
    // AI : Image is already loaded, apply outline immediately
    applySelectionOutline(overlayObject);
  } else {
    // AI : Image not loaded yet, wait for load event
    imgElement.addEventListener("load", () => { applySelectionOutline(overlayObject) }, { once: true });
  }
}

/**
 * AI : Select an overlay with proper cleanup of previous selection
 * This ensures consistent selection behavior regardless of how selection is triggered
 */
export function selectOverlay(overlayId: string | null): void {
  // AI : Prevent recursive calls (library's select event → selectOverlay → overlay.select → select event)
  if (isSelectingOverlay) return;

  const overlayStore = useOverlayStore();

  // AI : Early exit if already selected
  if (overlayId === overlayStore.idSelectedOverlay) return;

  isSelectingOverlay = true;
  try {
    // AI : Store previous selection info before updating
    const previouslySelectedId = overlayStore.idSelectedOverlay;
    const previouslySelected = previouslySelectedId ? overlayStore.overlays[previouslySelectedId] : null;

    // AI : Update selected overlay ID
    overlayStore.idSelectedOverlay = overlayId;

    // AI : Clean up previous selection if different from new selection
    if (previouslySelected && previouslySelectedId) {
      cleanupPreviousSelection(previouslySelected, previouslySelectedId, overlayId);
    }

    if (!overlayId) return;

    // AI : Apply selection to new overlay
    const newlySelected = overlayStore.overlays[overlayId];
    if (!newlySelected) return;

    setupNewSelection(newlySelected, overlayId);
  } finally {
    isSelectingOverlay = false;
  }
}

function applySelectionOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const element = overlayObject.overlay.getElement();
  if (element) {
    // AI : Calculate appropriate outline size based on overlay dimensions
    const outlineSize = calculateOutlineSize(element, 20);

    // AI : Use box-shadow instead of outline to avoid scaling issues
    element.style.boxShadow = `0 0 0 ${outlineSize}px ${OVERLAY_OUTLINE_COLOR}`;
    element.style.outline = 'none';
  }
}

/**
 * AI : Remove outline from a single overlay
 */
function removeOverlayOutline(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const element = overlayObject.overlay.getElement();
  if (element) {
    element.style.boxShadow = '';
    element.style.outline = 'none';
  }
}

/**
 * AI : Highlight a single overlay by ID - used for hover from side menu
 * Scales up the marker if it exists (visible even when zoomed out)
 */
export function highlightOverlayById(overlayId: string): void {
  const overlayStore = useOverlayStore();

  // AI : Scale up the marker for visibility at any zoom level
  const marker = overlayStore.allMarkers[overlayId];
  if (marker) {
    const markerElement = marker.getElement();
    if (markerElement) {
      // AI : Scale the SVG inside the marker to avoid interfering with Leaflet's translate3d positioning
      const svg = markerElement.querySelector('svg');
      if (svg) {
        svg.style.transformOrigin = 'center bottom';
        svg.style.transition = 'transform 0.15s ease';
        svg.style.transform = 'scale(1.5)';
      }
      markerElement.style.zIndex = '1000';
    }
  }
}

/**
 * AI : Remove highlight from a single overlay by ID - used for hover leave from side menu
 */
export function removeOverlayHighlight(overlayId: string): void {
  const overlayStore = useOverlayStore();

  // AI : Reset marker scale
  const marker = overlayStore.allMarkers[overlayId];
  if (marker) {
    const markerElement = marker.getElement();
    if (markerElement) {
      const svg = markerElement.querySelector('svg');
      if (svg) {
        svg.style.transform = '';
      }
      markerElement.style.zIndex = '';
    }
  }
}

/**
 * AI : Remove outlines from all overlays in a project
 * @param projectId - The project whose overlays should have outlines removed
 * @param force - If true, removes outlines even if an overlay in the project is selected
 */
export function removeProjectOutlines(projectId: string, force = false): void {
  const overlayStore = useOverlayStore();

  if (!projectId) return;

  // AI : Don't remove outlines if an overlay in this project is selected (unless forced)
  if (!force) {
    const selectedOverlay = overlayStore.idSelectedOverlay ? overlayStore.overlays[overlayStore.idSelectedOverlay] : null;
    if (selectedOverlay?.projectId === projectId) return;
  }

  // AI : Remove all outlines from overlays in this project
  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        element.style.boxShadow = '';
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Highlight all overlays from the same project on hover
 */
export function highlightProjectOverlaysOnHover(projectId: string): void {
  const overlayStore = useOverlayStore();

  if (!projectId) return;

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (overlayObject.projectId === projectId && overlayObject.overlay) {
      const element = overlayObject.overlay.getElement();
      if (element) {
        // AI : Calculate appropriate outline size based on overlay dimensions
        const outlineSize = calculateOutlineSize(element, 20);

        // AI : Use box-shadow instead of outline to avoid scaling issues
        element.style.boxShadow = `0 0 0 ${outlineSize}px ${OVERLAY_OUTLINE_COLOR}`;
        element.style.outline = 'none';
      }
    }
  });
}

/**
 * AI : Setup hover event listeners for project highlighting in view mode
 */
export function setupProjectHoverEvents(overlay: L.DistortableImageOverlay, overlayObject: OverlayObject): void {
  if (!overlayObject.projectId) return;

  const element = overlay.getElement();
  if (!element) return;

  element.addEventListener('mouseenter', () => {
    if (overlayObject.projectId) {
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  element.addEventListener('mouseleave', () => {
    if (overlayObject.projectId) {
      removeProjectOutlines(overlayObject.projectId);
    }
  });
}

/**
 * AI : Setup map click handler to deselect overlays when clicking the map background
 */
export function setupMapClickToDeselect(): void {
  if (!map.value) return;

  map.value.on('click', () => {
    const overlayStore = useOverlayStore();
    // AI : Deselect if currently selected - overlay click handlers will re-select if clicked
    if (overlayStore.idSelectedOverlay) {
      selectOverlay(null);
    }
  });
}

/**
 * AI : Calculate appropriate outline size based on overlay dimensions and aspect ratio
 * This ensures consistent visual outline regardless of overlay shape & resolution
 */
export function calculateOutlineSize(overlayElement: HTMLElement, baseSize: number): number {
  if (!overlayElement) return baseSize;

  try {
    // AI : Get the actual image element
    const imgElement = overlayElement instanceof HTMLImageElement
      ? overlayElement
      : overlayElement.querySelector('img');

    if (!imgElement) return baseSize;

    // AI : Get natural image dimensions
    const naturalWidth = imgElement.naturalWidth;
    const naturalHeight = imgElement.naturalHeight;

    if (naturalWidth <= 0 || naturalHeight <= 0) return baseSize;

    // AI : Calculate outline size based on image resolution
    // Use the smaller dimension to get consistent visual thickness
    const naturalSmallerDimension = Math.min(naturalWidth, naturalHeight);

    // AI : Scale the base outline size by the image resolution
    // Larger images need proportionally larger outlines to appear the same thickness
    const scaleFactor = naturalSmallerDimension / 500;
    const scaledOutline = baseSize * scaleFactor;

    // AI : Clamp to reasonable bounds
    return Math.max(1, Math.min(50, Math.round(scaledOutline)));

  } catch {
    // AI : Silently fall back to base size on error
    return baseSize;
  }
}
