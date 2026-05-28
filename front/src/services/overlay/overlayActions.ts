import { LngLat, LngLatBounds } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import type { OverlayObject } from "@/types/index";
import { trpc } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { getMarker } from "@/services/overlay/overlayRenderRegistry";
import { updateMarkerTooltip } from "@/services/map/markers";
import { getOverlayBounds } from "@/services/overlay/overlayMarkers";

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
 * Navigates between overlays in the current project based on direction.
 */

export function navigateOverlaySequence(direction: "next" | "previous") {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // Handle case when no overlay is selected
  if (!overlayStore.idSelectedOverlay) {
    selectFirstOrLastOverlayInAnyProject(direction);
    return;
  }

  const currentOverlay = overlayStore.overlays[overlayStore.idSelectedOverlay];

  if (!currentOverlay?.projectId) {
    return;
  }

  const project = projectStore.projects[currentOverlay.projectId];
  let projectOverlayIds: string[] = [];

  // If project is not in memory, or overlayIds not yet populated (only set on popup open),
  // derive siblings from already-loaded overlays.
  if (!project?.overlayIds.length) {
    projectOverlayIds = Object.values(overlayStore.overlays)
      .filter((overlay) => overlay.projectId === currentOverlay.projectId)
      .map((overlay) => overlay.id);
  } else {
    projectOverlayIds = project.overlayIds;
  }

  if (projectOverlayIds.length <= 1) {
    const toast = useToast();
    toast.add({ severity: "info", summary: t("overlay.onlyOneOverlayInProject"), life: 3000 });
    return;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(overlayStore.idSelectedOverlay);
  const step = direction === "next" ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];

  if (!newOverlayId) {
    console.error("Overlay not found for ID:", newOverlayId);
    return;
  }

  selectAndCenterOverlay(newOverlayId);
}

function selectFirstOrLastOverlayInAnyProject(direction: "next" | "previous") {
  const projectStore = useProjectStore();
  const projectIds = Object.keys(projectStore.projects);
  if (projectIds.length === 0) {
    throw new Error("No projects: Please create a project first");
  }

  for (const projectId of projectIds) {
    const project = projectStore.projects[projectId];
    if (!project) {
      console.error("Project not found for ID:", projectId);
      continue;
    }
    if (project.overlayIds.length > 0) {
      // Select first overlay for 'next', last overlay for 'previous'
      const index = direction === "next" ? 0 : project.overlayIds.length - 1;
      const overlayId = project.overlayIds[index];
      if (!overlayId) {
        console.error("Overlay not found for ID:", overlayId);
        continue;
      }

      if (selectAndCenterOverlay(overlayId)) {
        return;
      }
    }
  }
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

  if (overlayStore.overlays[overlayId]) {
    return { alreadyInStore: true };
  }

  return withErrorHandling(
    async () => {
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting,
      });

      if (!result.overlay) {
        throw new Error("Overlay not found");
      }

      const { renderViewModeOverlays } = await import("@/services/overlay/overlayRendering");

      renderViewModeOverlays([result.overlay], true);

      if (includeIntersecting && result.intersectingOverlays.length > 0) {
        renderViewModeOverlays(result.intersectingOverlays, true);
      }

      // Don't check overlayStore.overlays[overlayId] here: overlay registration is async
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
  const navigated = selectAndCenterOverlay(overlayId);
  if (!navigated && loadResult?.corners && loadResult.corners.length >= 4) {
    const bounds = new LngLatBounds();
    for (const c of loadResult.corners) {
      bounds.extend(new LngLat(c.lng, c.lat));
    }
    mobileAwareFlyToBounds(bounds);
  }
  return true;
}

function selectAndCenterOverlay(overlayId: string) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.overlays[overlayId];

  if (!overlay) {
    return false;
  }

  selectOverlay(overlayId);
  zoomToOverlayBounds(overlay);

  return true;
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();

  const overlayObject = overlayStore.overlays[id];
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

  updateMarkerTooltip(overlayObject);
}
