import { LngLat } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import type { OverlayObject } from "@/types/index";
import { trpc } from "@/client";
import { selectOverlay, raiseSelectedOverlayWhenReady } from "@/services/overlay/selection";
import { getMarker } from "@/services/overlay/mapLayers";
import { getOverlayBounds } from "@/services/overlay/markers";
import { isValidQuad } from "@/services/overlay/transform";
import { buildLngLatBounds } from "@/utils/cornersBounds";
import { overlayWireToData } from "@/utils/typeFactories";
import { toastInfo } from "@/services/core/toast";

// Helper to zoom to overlay bounds
function zoomToOverlayBounds(overlay: OverlayObject): void {
  // Try to get bounds from overlay data (works whether the image layer exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds);
    return;
  }

  // Fall back to marker position if bounds unavailable
  const marker = getMarker(overlay.id);
  if (marker) {
    const lngLat = marker.getLngLat();
    mobileAwareFlyTo(new LngLat(lngLat.lng, lngLat.lat), 17);
  }
}

/**
 * Sibling overlay ids of a project, derived from already-loaded overlays (not
 * project.overlayIds, which is only populated on detail open and can list overlays
 * that aren't loaded, hence not selectable). Shared by the toolbar index display and
 * prev/next navigation so both agree on order and count.
 */
export function getProjectSiblingOverlayIds(projectId: string): string[] {
  const overlayStore = useOverlayStore();
  return Object.values(overlayStore.liveOverlays)
    .filter((overlay) => overlay.projectId === projectId)
    .map((overlay) => overlay.id);
}

/**
 * Navigates between overlays in the current project based on direction.
 */

export function navigateOverlaySequence(direction: "next" | "previous") {
  const overlayStore = useOverlayStore();
  const selectedOverlayId = useFocusStore().selectedOverlayId;

  // Only callable from the floating toolbar, which requires a selected overlay.
  if (!selectedOverlayId) {
    return;
  }

  const currentOverlay = overlayStore.liveOverlays[selectedOverlayId];

  if (!currentOverlay?.projectId) {
    return;
  }

  const projectOverlayIds = getProjectSiblingOverlayIds(currentOverlay.projectId);

  if (projectOverlayIds.length <= 1) {
    toastInfo(t("overlay.onlyOneOverlayInProject"));
    return;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(selectedOverlayId);
  const step = direction === "next" ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  // newIndex is always in range: modulo over projectOverlayIds, which has length > 1 here.
  // oxlint-disable-next-line no-non-null-assertion
  const newOverlayId = projectOverlayIds[newIndex]!;

  selectAndCenterOverlay(newOverlayId);
}

/**
 * Loads an overlay by ID, fetching from backend if needed. Throws on fetch failure.
 */
type LoadOverlayResult = {
  alreadyInStore: boolean;
  corners?: { lat: number; lng: number }[];
};

async function loadOverlay(overlayId: string): Promise<LoadOverlayResult> {
  const overlayStore = useOverlayStore();

  if (overlayStore.liveOverlays[overlayId]) {
    return { alreadyInStore: true };
  }

  const result = await trpc.overlay.getOverlay.query({
    id: overlayId,
    includeIntersecting: true,
  });

  if (!result.overlay) {
    throw new Error("Overlay not found");
  }

  // The overlay rendering module is lazy-loaded as its own shared chunk. A static import would
  // merge it into this chunk and defeat that split (INEFFECTIVE_DYNAMIC_IMPORT).
  const { renderBackendOverlays } = await import("@/services/overlay/rendering");

  renderBackendOverlays([overlayWireToData(result.overlay)]);

  if (result.intersectingOverlays.length > 0) {
    renderBackendOverlays(result.intersectingOverlays.map(overlayWireToData));
  }

  // Don't check overlayStore.liveOverlays[overlayId] here: overlay registration is async
  // (happens after image loads) and may not complete if zoom level is too low.
  // Return corners so the caller can fly to the overlay immediately.
  return { alreadyInStore: false, corners: result.overlay.corners };
}

/**
 * Navigates to a specific overlay by ID (loads + selects + centers).
 */
export async function navigateToOverlay(overlayId: string): Promise<boolean> {
  const loadResult = await loadOverlay(overlayId);

  if (loadResult.alreadyInStore) {
    return selectAndCenterOverlay(overlayId);
  }

  // Overlay was just fetched -- registration is async (happens after image loads).
  // Select now if it registered in time, otherwise fly directly to the backend corners.
  if (selectAndCenterOverlay(overlayId)) {
    return true;
  }
  if (isValidQuad(loadResult.corners)) {
    mobileAwareFlyToBounds(buildLngLatBounds(loadResult.corners));
    return true;
  }
  return false;
}

function selectAndCenterOverlay(overlayId: string) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.liveOverlays[overlayId];

  if (!overlay) {
    return false;
  }

  selectOverlay(overlayId);
  zoomToOverlayBounds(overlay);
  // When selecting from the side panel while zoomed out, the image layer isn't rendered yet, so
  // the raise from selectOverlay no-ops. Re-raise once the flight renders it.
  raiseSelectedOverlayWhenReady(overlayId);

  return true;
}
