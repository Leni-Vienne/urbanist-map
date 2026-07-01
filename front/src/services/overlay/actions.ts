import { LngLat, LngLatBounds } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import type { OverlayObject } from "@/types/index";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay, applySelectionVisualsWhenReady } from "@/services/overlay/selection";
import { getMarker } from "@/services/overlay/mapLayers";
import { getOverlayBounds } from "@/services/overlay/markers";
import { overlayWireToData } from "@/utils/typeFactories";

// Helper to zoom to overlay bounds
function zoomToOverlayBounds(overlay: OverlayObject): boolean {
  // Try to get bounds from overlay data (works whether the image layer exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds);
    return true;
  }

  // Fall back to marker position if bounds unavailable
  const marker = getMarker(overlay.id);
  if (marker) {
    const lngLat = marker.getLngLat();
    mobileAwareFlyTo(new LngLat(lngLat.lng, lngLat.lat), 17);
    return true;
  }

  return false;
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
    const toast = useToast();
    toast.add({ severity: "info", summary: t("overlay.onlyOneOverlayInProject"), life: 3000 });
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
 * Loads an overlay by ID, fetching from backend if needed.
 * Returns loading result if successful, null on error.
 */
type LoadOverlayResult = {
  alreadyInStore: boolean;
  corners?: { lat: number; lng: number }[];
};

async function loadOverlay(
  overlayId: string,
  includeIntersecting: boolean = true,
): Promise<LoadOverlayResult | null> {
  const overlayStore = useOverlayStore();

  if (overlayStore.liveOverlays[overlayId]) {
    return { alreadyInStore: true };
  }

  return loadOrNull(
    async () => {
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting,
      });

      if (!result.overlay) {
        throw new Error("Overlay not found");
      }

      // Lazy-loaded as its own chunk: overlayRendering is dynamically imported here and in
      // vectorTileSync / viewportRenderLoop. A static import would merge it into this chunk and
      // defeat that split (INEFFECTIVE_DYNAMIC_IMPORT).
      const { renderViewModeOverlays } = await import("@/services/overlay/rendering");

      renderViewModeOverlays([overlayWireToData(result.overlay)], true);

      if (includeIntersecting && result.intersectingOverlays.length > 0) {
        renderViewModeOverlays(result.intersectingOverlays.map(overlayWireToData), true);
      }

      // Don't check overlayStore.liveOverlays[overlayId] here: overlay registration is async
      // (happens after image loads) and may not complete if zoom level is too low.
      // Return corners so the caller can fly to the overlay immediately.
      return { alreadyInStore: false, corners: result.overlay.corners };
    },
    { errorMessage: "Failed to load overlay", rethrow: true },
  );
}

/**
 * Navigates to a specific overlay by ID (loads + selects + centers).
 */
export async function navigateToOverlay(
  overlayId: string,
  includeIntersecting: boolean,
): Promise<boolean> {
  const loadResult = await loadOverlay(overlayId, includeIntersecting);

  if (loadResult?.alreadyInStore) {
    return selectAndCenterOverlay(overlayId);
  }

  // Overlay was just fetched -- registration is async (happens after image loads).
  // Select now if it registered in time, otherwise fly directly to the backend corners.
  if (selectAndCenterOverlay(overlayId)) {
    return true;
  }
  if (loadResult?.corners && loadResult.corners.length >= 4) {
    const bounds = new LngLatBounds();
    for (const c of loadResult.corners) {
      bounds.extend(new LngLat(c.lng, c.lat));
    }
    mobileAwareFlyToBounds(bounds);
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
  // the edit handles / outline from selectOverlay no-op. Re-apply them once the flight renders it.
  applySelectionVisualsWhenReady(overlayId);

  return true;
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();

  const overlayObject = overlayStore.liveOverlays[id];
  if (!overlayObject) return;

  // Track if caption actually changed to set isModified flag
  const oldCaption = overlayObject.caption;
  const newCaption = info.caption ?? null;
  const captionChanged = oldCaption !== newCaption;

  overlayObject.caption = newCaption;

  if (captionChanged) {
    overlayObject.isModified = true;
    // New overlays (status null) carry their caption on the overlay object itself; only
    // approved/pending overlays need a delta tracked here for the change-request flow.
    if (overlayObject.status !== null) {
      pendingModsStore.saveCaptionChange(
        id,
        overlayObject.projectId ?? null,
        newCaption,
        oldCaption,
        overlayObject.status,
      );
    }
  }
}
