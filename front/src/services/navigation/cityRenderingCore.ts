// AI : Shared rendering primitives for city overlays and standalone markers.
// AI : Used by both viewport-based loading (useViewportContentManager) and
// AI : navigation-triggered loading (cityDataRenderer / overlayNavigation).
// AI : This module has no circular dependency risk: it only imports from stores,
// AI : map primitives, and utility services — none of which import from this file.

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { removeOverlayMarkers, renderOverlayMarkersFromData } from "@/services/map/cityOverlays";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { addStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { pruneMapEntities } from "@/services/map/viewportPruning";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import type { OverlayData } from "@/types/index";
import {
  createProjectObject,
  toProjectPartial,
  type StandaloneProject,
} from "@/utils/typeFactories";

/**
 * AI : Add standalone project markers for projects that have no visible overlays.
 * AI : Unified version of the near-identical functions that existed in both
 * AI : useViewportContentManager and cityDataRenderer.
 * AI : Also unifies the 3-branch overlayCount type narrowing into one place.
 */
export function processStandaloneMarkers(
  standaloneProjects: StandaloneProject[],
  overlaysData: OverlayData[] | null,
): void {
  if (standaloneProjects.length === 0) return;

  const projectIdsWithOverlays = new Set<string>();
  if (overlaysData) {
    for (const overlay of overlaysData) {
      if (overlay.projectId) {
        projectIdsWithOverlays.add(overlay.projectId);
      }
    }
  }

  for (const project of standaloneProjects) {
    // AI : Unified overlay count check spanning all StandaloneProject union members
    let overlayCount = 0;
    if ("overlayCount" in project) {
      overlayCount = project.overlayCount;
    } else if ("overlayIds" in project && Array.isArray(project.overlayIds)) {
      overlayCount = project.overlayIds.length;
    } else if ("overlays" in project && Array.isArray(project.overlays)) {
      overlayCount = project.overlays.length;
    }

    if (!projectIdsWithOverlays.has(project.id) && overlayCount === 0) {
      addStandaloneProjectMarkerForProject(createProjectObject(toProjectPartial(project)));
    }
  }
}

/**
 * AI : Render full overlay images (high zoom path).
 * AI : Removes low-zoom dot markers, hydrates the store with fresh backend data,
 * AI : synchronizes overlay metadata via a batch update (O(1) reactivity trigger),
 * AI : updates marker colors, then delegates actual positioning to the pruning service.
 * AI : Standardizes on the batch-update approach from the viewport manager.
 */
export function renderFullOverlays(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : Switch from dot-marker display to full overlay image display
  removeOverlayMarkers();
  overlayStore.setViewModeOverlays(overlaysData);
  mapStore.currentCityOverlays = overlaysData;

  // AI : Batch update overlay metadata from fresh backend data.
  // AI : Critical for mode switches (view → edit, view → moderation) where overlays
  // AI : are already on the map but need updated hasPendingChanges / suggestedCorners.
  const updates: Record<string, Partial<OverlayData>> = {};
  for (const overlayData of overlaysData) {
    if (overlayStore.overlays[overlayData.id]) {
      updates[overlayData.id] = {
        hasPendingChanges: overlayData.hasPendingChanges,
        suggestedCorners: overlayData.suggestedCorners,
        pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
      };
    }
  }
  if (Object.keys(updates).length > 0) {
    overlayStore.batchUpdateOverlays(updates);
  }

  // AI : Refresh marker colors to reflect the newly loaded state
  // AI : (e.g. a marker turning yellow when hasPendingChanges becomes true)
  updateOverlayMarkersColors(overlayStore.overlays, overlayStore.mode);

  // AI : Delegate to the pruning service so only in-viewport overlays are rendered,
  // AI : preventing unnecessary network requests for off-screen images.
  pruneMapEntities();
}

/**
 * AI : Render overlay dot markers only (low zoom path).
 * AI : Clears overlay images and renders centroid markers.
 * AI : NOTE: This is the simple navigation-path version.
 * AI : The viewport manager keeps its own renderMarkersOnly that handles
 * AI : edit-mode overlay reconstruction from the store.
 */
export function renderMarkersOnly(overlaysData: OverlayData[]): void {
  clearAllOverlays();
  renderOverlayMarkersFromData(overlaysData);
}
