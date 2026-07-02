import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import {
  getMarker,
  getRenderedOverlayIds,
  hasReadyLayer,
  whenImageReady,
  raiseOverlayImage,
} from "@/services/overlay/mapLayers";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import type { OverlayObject } from "@/types/index";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { isOverlayUnsaved } from "@/utils/unsavedState";

type Corner = { lat: number; lng: number };

// Guard to prevent recursive selectOverlay calls when library fires select event
let isSelectingOverlay = false;

function setupNewSelection(newlySelected: OverlayObject, overlayId: string): void {
  // Set position state for dynamic button feedback when selecting overlay
  // Default to viewing the approved position on first selection
  if (newlySelected.isViewingApprovedPosition === undefined) {
    newlySelected.isViewingApprovedPosition = true;
  }

  // Raise the clicked image above its siblings so the one the user picked is never hidden.
  raiseOverlayImage(overlayId);

  // Sync preview state for reactive button highlighting in change request UI
  syncPreviewStateOnNavigation(overlayId, newlySelected.isViewingApprovedPosition);
}

/**
 * Select an overlay. The map highlight (sister overlays + footprint) follows the focus store
 * reactively; this owns the non-reactive selection work (raised image, country sync, project hydration).
 */
export function selectOverlay(overlayId: string | null): void {
  // Prevent recursive calls (library's select event -> selectOverlay -> overlay.select -> select event)
  if (isSelectingOverlay) return;

  const overlayStore = useOverlayStore();
  const focus = useFocusStore();

  // Already selected: the detail is the selection, so it is already shown.
  if (overlayId === focus.selectedOverlayId) return;

  isSelectingOverlay = true;
  try {
    if (!overlayId) {
      focus.clearSelection();
      return;
    }

    const newlySelected = overlayStore.liveOverlays[overlayId];
    if (!newlySelected) return;

    // Pin the overlay; this replaces any open project detail (mutual exclusivity is free).
    focus.selectOverlay(overlayId);

    setupNewSelection(newlySelected, overlayId);

    // In moderation mode, switch the panel to this overlay's country so its pending submissions load.
    syncModerationCountryFromMapClick(newlySelected.project?.countryCode);

    // Fetch the overlay's project if the selection came from the map (vector tiles don't always
    // carry the full project) so the docked detail can resolve it.
    void hydrateOverlayProject(overlayId);
  } finally {
    isSelectingOverlay = false;
  }
}

// The docked overlay detail needs the overlay's full Project. Map (vector tile) selections only
// carry minimal data, so fetch and cache the project when neither the store nor the overlay has it.
async function hydrateOverlayProject(overlayId: string): Promise<void> {
  const overlayStore = useOverlayStore();
  const overlay = overlayStore.liveOverlays[overlayId];
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
  const focus = useFocusStore();

  function applyVisuals(): void {
    // Selection changed while we were waiting; abandon.
    if (focus.selectedOverlayId !== overlayId) return;

    const overlay = overlayStore.liveOverlays[overlayId];
    if (!overlay) return;

    raiseOverlayImage(overlayId);
  }

  // ~5s budget, matching the overlay auto-select wait elsewhere.
  whenImageReady(overlayId, applyVisuals, { timeoutMs: 5000 });
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

/**
 * Remove highlight from a single overlay by ID - used for hover leave from side menu
 */
export function removeOverlayHighlight(overlayId: string): void {
  // Reset marker scale
  const marker = getMarker(overlayId);
  if (marker) {
    const markerElement = marker.getElement();
    const svg = markerElement.querySelector("svg");
    if (svg) {
      svg.style.transform = "";
    }
    markerElement.style.zIndex = "";
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
    const overlay = overlayStore.liveOverlays[id];
    if (!overlay) continue;
    // Approved overlays at their backend position are clicked via the vector-tile path.
    // We only run point-in-polygon for overlays whose live image can sit elsewhere.
    if (overlay.status === "approved" && !isOverlayUnsaved(overlay)) continue;
    const corners = resolveOverlayCorners(overlay, "image");
    if (corners?.length === 4 && isPointInCorners(lngLat, corners)) {
      selectOverlay(id);
      return;
    }
  }

  // No overlay under the click: clear whichever detail (overlay or project) is open.
  const focus = useFocusStore();
  if (focus.selection) focus.clearSelection();
}
