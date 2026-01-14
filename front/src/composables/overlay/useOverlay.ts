import L from "leaflet";
import "leaflet-toolbar";
import "leaflet-distortableimage";
import { t } from "@/locales";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayObject } from "@/types/index";
import { convertOverlayToData } from "@/utils/typeFactories";
import { useProjects } from "@/composables/project/useProjects";
import { trpc } from "@/client";
import { withErrorHandling } from "@/composables/core/useErrorHandling";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { updateMarkerTooltip, getOverlayBounds } from "@/composables/overlay/useOverlayMarkers";
import {
  renderViewModeOverlays,
  registerRenderingCallbacks,
} from "@/composables/overlay/useOverlayRendering";
import {
  updateOverlayEditingState,
  checkOverlaySizeAndWarn,
  addOverlay,
  undo,
  redo,
  resetImageRatio,
} from "@/composables/overlay/useOverlayEditing";

// AI : updateOverlayEditingState moved to useOverlayEditing.ts

// AI : checkOverlaySizeAndWarn moved to useOverlayEditing.ts

// AI : getCornersForOverlay, getCornersForOverlayWithCache, isValidCorners moved to useOverlayHistory.ts

// AI : createMarkerTitle, updateMarkerPosition moved to useOverlayMarkers.ts

// AI : saveToHistory moved to useOverlayHistory.ts

// AI : saveOverlayModificationsToCache moved to useOverlayHistory.ts

/**
 * AI : Add new overlay to city cache so it persists across zoom changes
 */
// AI : addNewOverlayToCityCache moved to useOverlayCityCache.ts to break circular dependency
export { addNewOverlayToCityCache } from "@/composables/overlay/useOverlayCityCache";

// AI : Selection functions moved to useOverlaySelection.ts

// AI : renderViewModeOverlays moved to useOverlayRendering.ts

// AI : overlaysBeingCreated moved to useOverlayRendering.ts

// AI : renderSingleOverlay moved to useOverlayRendering.ts

// AI : updateMarkerTooltip moved to useOverlayMarkers.ts

// AI : createSingleMarker moved to useOverlayMarkers.ts

// AI : setupOverlayMovementTracking moved to useOverlayRendering.ts

// AI : Overlay Action Functions (moved from useOverlayActions.ts to break circular dependency)

// AI : Helper function to transform backend overlay to CDN format
// AI : Use factory function from typeFactories.ts - removed local implementation

// AI : createNewOverlayObject moved to useOverlayEditing.ts

// AI : Helper function to zoom to overlay bounds with proper error handling
function zoomToOverlayBounds(overlay: OverlayObject): boolean {
  if (!map.value) return false;

  // AI : Try to get bounds from overlay data (works whether Leaflet overlay exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });
    return true;
  }

  // AI : Fallback to marker position if bounds unavailable
  if (overlay.marker) {
    mobileAwareFlyTo(overlay.marker.getLatLng(), 17, { duration: 1.5, easeLinearity: 0.25 });
    return true;
  }

  return false;
}

// AI : addOverlay moved to useOverlayEditing.ts

/**
 * AI : Navigates between overlays in the current project based on direction
 * @param direction - Either 'next' or 'previous' to determine navigation direction
 * @returns boolean indicating whether navigation was successful
 */

function focusCameraToOverlay(direction: "next" | "previous") {
  const overlayStore = useOverlayStore();
  const { projects } = useProjects();

  if (!map.value) {
    throw new Error("Map not available: Cannot navigate between overlays");
  }

  // Handle case when no overlay is selected
  if (!overlayStore.idSelectedOverlay) {
    return selectFirstOrLastOverlayInAnyProject(direction);
  }

  const currentOverlay = overlayStore.overlays[overlayStore.idSelectedOverlay];

  if (!currentOverlay?.projectId) {
    return false;
  }

  let project = projects.value[currentOverlay.projectId];
  let projectOverlayIds: string[];

  // AI : If project is not in memory, just find overlays with same projectId
  if (!project) {
    projectOverlayIds = Object.values(overlayStore.overlays)
      .filter((overlay) => overlay.projectId === currentOverlay.projectId)
      .map((overlay) => overlay.id);
  } else {
    projectOverlayIds = project.overlayIds;
  }

  if (projectOverlayIds.length <= 1) {
    const toast = useToast();
    toast.add({ severity: "info", summary: t("overlay.onlyOneOverlayInProject"), life: 3000 });
    return false;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(overlayStore.idSelectedOverlay);
  const step = direction === "next" ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];

  return selectAndCenterOverlay(newOverlayId);
}

function selectFirstOrLastOverlayInAnyProject(direction: "next" | "previous") {
  const { projects } = useProjects();
  const projectIds = Object.keys(projects.value);
  if (!projectIds.length) {
    throw new Error("No projects: Please create a project first");
  }

  for (const projectId of projectIds) {
    const project = projects.value[projectId];
    if (project.overlayIds.length > 0) {
      // Select first overlay for 'next', last overlay for 'previous'
      const index = direction === "next" ? 0 : project.overlayIds.length - 1;
      const overlayId = project.overlayIds[index];

      if (selectAndCenterOverlay(overlayId)) {
        // AI : Selected first/last overlay in project
        return true;
      }
    }
  }

  return false;
}

/**
 * AI : Loads an overlay by ID, fetching from backend if needed
 * AI : This function only handles loading/rendering, not navigation
 * @param overlayId - The ID of the overlay to load
 * @param includeIntersecting - Whether to fetch intersecting overlays (defaults to true for backward compatibility)
 * @returns true if overlay was loaded successfully
 */
async function loadOverlay(
  overlayId: string,
  includeIntersecting: boolean = true,
): Promise<boolean | null> {
  const overlayStore = useOverlayStore();

  // AI : Check if overlay is already loaded locally
  if (overlayStore.overlays[overlayId]) {
    return true;
  }

  // AI : Overlay not found locally - fetch from backend
  return withErrorHandling(
    async () => {
      // AI : Fetch overlay, optionally with intersecting overlays
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting,
      });

      if (!result.overlay) {
        throw new Error("Overlay not found");
      }

      // AI : Render the main overlay
      renderViewModeOverlays([result.overlay], true, false);

      // AI : Render intersecting overlays if they exist
      if (includeIntersecting && result.intersectingOverlays.length > 0) {
        renderViewModeOverlays(result.intersectingOverlays, true, false);
      }

      // AI : NOTE: We don't check overlayStore.overlays[overlayId] here because overlay registration
      // AI : is async (happens after image loads) and may not complete if zoom level is too low.
      // AI : The critical point is that the backend fetch succeeded.
      return true;
    },
    { errorMessage: "Failed to load overlay", rethrow: true },
  );
}

/**
 * AI : Navigates to a specific overlay by ID (loads + selects + centers)
 * @param overlayId - The ID of the overlay to navigate to
 * @param centerMap - Whether to center the map on the overlay
 * @param includeIntersecting - Whether to fetch intersecting overlays if overlay needs to be loaded
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlay(
  overlayId: string,
  centerMap: boolean,
  includeIntersecting: boolean,
): Promise<boolean> {
  // AI : Load the overlay first (fetches from backend if needed)
  await loadOverlay(overlayId, includeIntersecting);

  // AI : Then navigate to it
  return selectAndCenterOverlay(overlayId, centerMap);
}

function selectAndCenterOverlay(overlayId: string, centerMap: boolean = true) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.overlays[overlayId];

  if (!overlay) {
    return false;
  }

  // AI : selectOverlay handles overlay.select() internally
  selectOverlay(overlayId);

  // AI : Center map on overlay if requested
  if (centerMap) {
    zoomToOverlayBounds(overlay);
  }

  return true;
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();

  const overlayObject = overlayStore.overlays[id];
  if (!overlayObject) return;

  // AI : Track if caption actually changed to set isModified flag
  const oldCaption = overlayObject.caption;
  const newCaption = info.caption ?? null;
  const captionChanged = oldCaption !== newCaption;

  overlayObject.caption = newCaption;

  // AI : Mark as modified if caption changed, so save button enables
  if (captionChanged) {
    overlayObject.isModified = true;
  }

  // AI : Save only the specific overlay being updated, not all overlays
  updateMarkerTooltip(overlayObject);
}

// AI : All toolbar definitions moved to useOverlayToolbar.ts
// AI : Import getEditToolsForOverlay and getViewTools from there

// AI : Register toolbar callbacks to avoid circular dependencies
// AI : Register navigation callback with useOverlayEditing.ts
import { registerNavigationCallback } from "@/composables/overlay/useOverlayEditing";

// AI : Defer registration until after module initialization to avoid temporal dead zone
queueMicrotask(() => {
  registerNavigationCallback(focusCameraToOverlay);
});

// AI : Register rendering callbacks to avoid circular dependencies
registerRenderingCallbacks({
  checkOverlaySizeAndWarn,
});
