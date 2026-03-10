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
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { applySelectionRing, clearSelectionRing } from "@/services/overlay/overlayStyle";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayObject, Project } from "@/types/index";
import { getProjectMarkerColor } from "@/utils/markerColors";
import { markerColors, OVERLAY_OUTLINE_COLOR } from "@/services/map/markers";
import { highlightProjectShapes, unhighlightProjectShapes } from "@/services/map/shapeRendering";

// Guard to prevent recursive selectOverlay calls when library fires select event
let isSelectingOverlay = false;

/**
 * Resolve the timeline hex color for an overlay's project.
 * Falls back to the default blue if project data is unavailable.
 */
function resolveProjectHexColor(overlayObject: OverlayObject): string {
  const proj = overlayObject.project;
  if (!proj) return OVERLAY_OUTLINE_COLOR;
  const mode = useMapStore().mode;
  const colorKey = getProjectMarkerColor(proj as unknown as Project, mode);
  return markerColors[colorKey];
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
  // If no explicit position state, default to showing approved position
  // UNLESS there are pending changes, in which case default to showing the suggested position (yellow marker)
  if (newlySelected.isViewingApprovedPosition === undefined) {
    if (newlySelected.hasPendingChanges) {
      newlySelected.isViewingApprovedPosition = false;
    } else {
      newlySelected.isViewingApprovedPosition = true;
    }
  }

  // Sync preview state for reactive button highlighting in change request UI
  syncPreviewStateOnNavigation(overlayId, newlySelected.isViewingApprovedPosition);

  // Call overlay.select() to show toolbar and handles (single source of truth)
  const newLayer = getLayer(newlySelected.id);
  if (newLayer) {
    selectOverlayInLeaflet(newLayer);
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
  const mapStore = useMapStore();

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

    // Set selectedCity to enable panel auto-switch from Latest to Current Location
    const foundCityId = findCityIdForOverlay(overlayId, mapStore.mode);

    if (foundCityId) {
      // Look up city info from citiesLookup map (no circular dependency)
      const city = mapStore.citiesLookup.get(foundCityId);

      if (city) {
        // Set selectedCity when null/undefined OR when switching to a different city
        if (!mapStore.selectedCity || mapStore.selectedCity.id !== city.id) {
          mapStore.setSelectedCity(city);
        }
      }
    }

    setupNewSelection(newlySelected, overlayId);

    // Request scroll to overlay in accordion panel when selecting from map
    requestScrollTo("overlay", overlayId);
  } finally {
    isSelectingOverlay = false;
  }
}

/**
 * Helper to find which city an overlay belongs to
 * Searches cache first, then moderation store if applicable
 */
function findCityIdForOverlay(overlayId: string, mode: string): number | null {
  const mapStore = useMapStore();
  let foundCityId: number | null = null;

  // Iterate through all cached cities to find which one contains this overlay
  for (const [cityId, modeCache] of mapStore.cityProjectsCache.entries()) {
    for (const overlays of modeCache.values()) {
      const overlay = overlays.find((o) => o.id === overlayId);
      if (overlay) {
        foundCityId = cityId;
        break;
      }
    }
    if (foundCityId) break;
  }

  // If not found in cache and in moderation mode, check moderation store
  if (!foundCityId && mode === "moderation") {
    const moderationStore = useModerationStore();
    const modOverlay = moderationStore.overlays.find((o) => o.id === overlayId);
    if (modOverlay?.cityId) {
      foundCityId = modOverlay.cityId;
    }
  }

  return foundCityId;
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

  // Unhighlight project shapes alongside the overlays
  unhighlightProjectShapes(projectId);
}

/**
 * Highlight all overlays (and shapes) from the same project on hover/select.
 * Uses the project's timeline color instead of the default blue.
 */
export function highlightProjectOverlaysOnHover(projectId: string): void {
  const overlayStore = useOverlayStore();

  if (!projectId) return;

  // Resolve the project color from any overlay that carries project data
  let hexColor = OVERLAY_OUTLINE_COLOR;
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    if (overlayObject.projectId === projectId && overlayObject.project) {
      hexColor = resolveProjectHexColor(overlayObject);
      break;
    }
  }

  for (const overlayObject of Object.values(overlayStore.overlays)) {
    if (overlayObject.projectId === projectId) {
      const hoverLayer = getLayer(overlayObject.id);
      if (hoverLayer) {
        const element = hoverLayer.getElement();
        if (element) {
          applySelectionRing(element, hexColor);
        }
      }
    }
  }

  // Highlight project shapes alongside the overlays
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
 * Setup hover event listeners for project highlighting in view mode
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
      highlightProjectOverlaysOnHover(overlayObject.projectId);
    }
  });

  element.addEventListener("mouseleave", () => {
    if (overlayObject.projectId) {
      removeProjectOutlines(overlayObject.projectId);
    }
  });
}

/**
 * In moderation mode, sync the selected city from the overlay's project context.
 * Called when clicking an overlay marker or image so the side panel shows the right city.
 */
export function syncModerationCityFromOverlay(overlayObject: OverlayObject): void {
  const mapStore = useMapStore();
  if (mapStore.mode !== "moderation" || !overlayObject.project?.city) return;

  const city = overlayObject.project.city;
  if (mapStore.selectedCity?.id !== city.id) {
    mapStore.setSelectedCity({
      id: city.id,
      name: city.name,
      nameLocal: city.nameLocal,
      countryCode: city.countryCode,
    });
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
