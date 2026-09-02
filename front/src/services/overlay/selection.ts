import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import {
  getMarker,
  getRenderedOverlayIdsTopToBottom,
  hasReadyLayer,
  whenImageReady,
  raiseOverlayImage,
  scheduleOverlayReconcile,
} from "@/services/overlay/mapLayers";
import type { LatLng } from "@/types/index";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { hasOpenChangeRequest, showsSuggestedState } from "@/services/overlay/positionState";
import { isOverlayUnsaved } from "@/services/overlay/unsavedState";

/**
 * Open overlay detail. The map highlight follows the focus store reactively; this owns the
 * non-reactive work (raised image and country sync).
 */
export function openOverlayDetail(overlayId: string): void {
  const overlayStore = useOverlayStore();
  const focus = useFocusStore();

  // Already selected: the detail is the selection, so it is already shown.
  if (overlayId === focus.selectedOverlayId) return;

  const newlySelected = overlayStore.liveOverlays[overlayId];
  if (!newlySelected) return;
  overlayStore.retainSelectedTileOverlay(overlayId);

  // Pin the overlay; this replaces any open project detail (mutual exclusivity is free).
  focus.setSelectionTarget({
    kind: "overlay",
    overlayId,
    projectId: newlySelected.projectId ?? null,
  });
  focus.setHoverTarget(null);
  scheduleOverlayReconcile();

  // Raise the clicked image above its siblings so the one the user picked is never hidden.
  raiseOverlayImage(overlayId);

  // In moderation mode, switch the panel to this overlay's country so its pending submissions load.
  const project = newlySelected.projectId
    ? useProjectStore().getMapProjectById(newlySelected.projectId, useUiStore().mode)
    : null;
  syncModerationCountryFromMapClick(project?.countryCode);
}

export function closeDetail(): void {
  useOverlayStore().clearSelectedTileOverlay();
  useFocusStore().setSelectionTarget(null);
}

// ~5s budget for an overlay's image layer to render before we stop waiting.
const OVERLAY_READY_TIMEOUT_MS = 5000;

/**
 * Run `run` once the overlay's image layer is ready, but only if it is still the selected overlay
 * by then. Bounded to OVERLAY_READY_TIMEOUT_MS so a layer that never renders doesn't leak a timer.
 */
export function whenImageReadyIfSelected(overlayId: string, run: () => void): void {
  whenImageReady(
    overlayId,
    () => {
      if (useFocusStore().selectedOverlayId === overlayId) run();
    },
    { timeoutMs: OVERLAY_READY_TIMEOUT_MS },
  );
}

/**
 * Raise the selected overlay's image once its layer renders. Opening the detail raises it immediately,
 * but when selection is triggered from the side panel while zoomed out, the layer isn't rendered
 * yet and the raise no-ops. The camera then flies in and the layer renders later; this waits for
 * it and re-raises. No-op when the layer is already present at selection time.
 */
export function raiseSelectedOverlayWhenReady(overlayId: string): void {
  if (hasReadyLayer(overlayId)) return;
  whenImageReadyIfSelected(overlayId, () => raiseOverlayImage(overlayId));
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

function isPointInCorners(point: LatLng, corners: LatLng[]): boolean {
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
 * Map click fallthrough: no vector/point feature was hit. Select the highest rendered overlay whose
 * current image requires manual footprint hit-testing, otherwise deselect.
 */
export function handleBackgroundClick(lngLat: { lng: number; lat: number }): void {
  const overlayStore = useOverlayStore();
  const renderedIds = getRenderedOverlayIdsTopToBottom();

  for (const id of renderedIds) {
    const overlay = overlayStore.liveOverlays[id];
    if (!overlay) continue;
    // Approved overlays at their backend position are clicked via the vector-tile path.
    // Point-in-polygon runs for overlays whose live image can sit elsewhere: staged edits, and an
    // open change request shown at its suggested position (the tile footprint stays at baseline).
    const showsSuggested = hasOpenChangeRequest(overlay) && showsSuggestedState(overlay);
    if (overlay.status === "approved" && !isOverlayUnsaved(overlay) && !showsSuggested) continue;
    // Outside a gesture the store-derived display position is where the image and click target sit.
    const corners = resolveOverlayCorners(overlay);
    if (corners && isPointInCorners(lngLat, corners)) {
      openOverlayDetail(id);
      return;
    }
  }

  // No overlay under the click: clear whichever detail (overlay or project) is open.
  closeDetail();
}
