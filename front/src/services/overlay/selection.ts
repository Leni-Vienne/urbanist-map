import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { getMarker, getRenderedOverlayIds, hasReadyLayer } from "@/services/overlay/renderRegistry";
import { raiseOverlayImage } from "@/services/overlay/imageLayer";
import { showEditHandles, hideEditHandles } from "@/services/overlay/editHandles";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { requestScrollTo } from "@/services/layout/accordionState";
import type { OverlayObject } from "@/types/index";
import { getOverlayMarkerColor, updateOverlayMarkerColor } from "@/services/map/markers";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";
import {
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeLayerRegistry";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { resolveOverlayRenderCorners } from "@/services/overlay/history";

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

  // Raise the clicked image above its siblings so the one the user picked is never hidden.
  raiseOverlayImage(overlayId);

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

  // Already selected: skip the reselect work, but re-show its docked detail in case a prior
  // action (e.g. the detail's Back button) hid it while keeping the overlay selected.
  if (overlayId === overlayStore.idSelectedOverlay) {
    if (overlayId) overlayStore.openOverlayDetail(overlayId);
    return;
  }

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

    // Deselecting clears the docked overlay detail.
    if (!overlayId) {
      overlayStore.closeOverlayDetail();
      return;
    }

    // Close standalone project detail when selecting an overlay (mutual exclusivity)
    const uiStore = useUiStore();
    if (uiStore.projectDetail.visible) {
      uiStore.closeProjectDetail();
    }

    // Apply selection to new overlay
    const newlySelected = overlayStore.overlays[overlayId];
    if (!newlySelected) return;

    setupNewSelection(newlySelected, overlayId);

    // In moderation mode, switch the panel to this overlay's country so its pending
    // submissions load (and the scroll request below can resolve once they do).
    syncModerationCountryFromMapClick(newlySelected.project?.countryCode);

    // Request scroll to overlay in accordion panel when selecting from map
    requestScrollTo("overlay", overlayId);

    // Drive the docked panel into this overlay's detail view, fetching its project if the
    // selection came from the map (vector tiles don't always carry the full project).
    overlayStore.openOverlayDetail(overlayId);
    void hydrateOverlayProject(overlayId);
  } finally {
    isSelectingOverlay = false;
  }
}

// The docked overlay detail needs the overlay's full Project. Map (vector tile) selections only
// carry minimal data, so fetch and cache the project when neither the store nor the overlay has it.
async function hydrateOverlayProject(overlayId: string): Promise<void> {
  const overlayStore = useOverlayStore();
  const overlay = overlayStore.overlays[overlayId];
  if (!overlay?.projectId) return;

  const projectStore = useProjectStore();
  if (projectStore.projects[overlay.projectId] || overlay.project) return;

  try {
    const result = await trpc.project.getById.query({ id: overlay.projectId });
    if (result) {
      projectStore.updateProject(
        overlay.projectId,
        createProjectObject({ ...result, tags: result.tags ?? [], overlayIds: [] }),
      );
    }
  } catch (error) {
    console.error("Failed to fetch project for overlay detail:", error);
  }
}

/**
 * Re-apply the selection visuals that depend on the rendered image layer (edit handles, overlay
 * outline, sister highlight, raised image). selectOverlay applies these immediately, but when
 * selection is triggered from the side panel while zoomed out, the layer isn't rendered yet and
 * those steps no-op. The camera then flies in and the layer renders later; this polls for it and
 * applies the visuals once ready. No-op when the layer is already present at selection time.
 */
export function applySelectionVisualsWhenReady(overlayId: string): void {
  if (hasReadyLayer(overlayId)) return;

  const overlayStore = useOverlayStore();
  let attempts = 0;

  function tryApply(): void {
    // Selection changed while we were waiting; abandon.
    if (overlayStore.idSelectedOverlay !== overlayId) return;

    if (!hasReadyLayer(overlayId)) {
      attempts += 1;
      // ~5s budget at 60fps, matching the overlay auto-select poll elsewhere.
      if (attempts > 300) return;
      requestAnimationFrame(tryApply);
      return;
    }

    const overlay = overlayStore.overlays[overlayId];
    if (!overlay) return;

    raiseOverlayImage(overlayId);
    if (useMapStore().mode === "edit") {
      showEditHandles(overlay);
    }
    if (overlay.projectId) {
      highlightProject(overlay.projectId, overlay.id);
    }
  }

  requestAnimationFrame(tryApply);
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
      // Scale the SVG inside the marker to avoid interfering with the marker's translate3d positioning
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
    if (uiStore.projectDetail.visible && uiStore.projectDetail.projectId === projectId) return;
  }

  // Unhighlight project shapes alongside the overlays (GeoJSON layers in edit/moderation, vector tiles in view mode)
  unhighlightProjectShapes(projectId);
  refreshSelectionHighlight();
}

/**
 * Highlight everything related to a project: project shapes, sister overlays, and the
 * vector tile filters (via the external-hover state). Called from sidebar hover,
 * overlay DOM hover, overlay selection, and selection refresh after mode switch.
 */
export function highlightProject(projectId: string, overlayId?: string): void {
  if (!projectId) return;

  setExternalHover(projectId, overlayId ?? null);

  // Project shape layers (standalone project geometry) exist in all modes
  highlightProjectShapes(projectId);
}

/**
 * Returns the projectId that is currently "highlighted" - either because an overlay of
 * that project is selected, or because the project detail (shape click) is open.
 */
export function getCurrentHighlightedProjectId(): string | null {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();

  const selected = overlayStore.idSelectedOverlay
    ? overlayStore.overlays[overlayStore.idSelectedOverlay]
    : null;
  return (
    selected?.projectId ?? (uiStore.projectDetail.visible ? uiStore.projectDetail.projectId : null)
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
  // eslint-disable-next-line no-plusplus
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
    if (!overlay) continue;
    // Approved overlays at their backend position are clicked via the vector-tile path.
    // We only run point-in-polygon for overlays whose live image can sit elsewhere.
    if (overlay.status === "approved" && !overlay.isModified) continue;
    const corners = resolveOverlayRenderCorners(overlay);
    if (corners?.length === 4 && isPointInCorners(lngLat, corners)) {
      selectOverlay(id);
      return;
    }
  }

  if (overlayStore.idSelectedOverlay) {
    selectOverlay(null);
    return;
  }

  // No overlay under the click: a background click also closes an open project detail.
  const uiStore = useUiStore();
  if (uiStore.projectDetail.visible) {
    uiStore.closeProjectDetail();
  }
}
