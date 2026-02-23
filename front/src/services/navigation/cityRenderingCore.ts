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
 * AI : Hydrates the store with fresh backend data, synchronizes overlay metadata
 * AI : via a batch update (O(1) reactivity trigger), updates marker colors, then
 * AI : delegates actual positioning to the pruning service.
 * AI : Dot markers (overlayMarkersLayer) are removed via requestAnimationFrame AFTER
 * AI : pruneMapEntities fires its dynamic-import microtask, ensuring store-managed
 * AI : markers are on the DOM before dot markers are removed (zero-gap transition).
 */
export function renderFullOverlays(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : Set data before rendering
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

  // AI : pruneMapEntities creates store-managed markers via a dynamic import (.then = microtask).
  // AI : Removing dot markers synchronously before that microtask runs leaves a visible gap.
  // AI : Deferring to requestAnimationFrame guarantees the microtask (and thus createSingleMarker)
  // AI : has already executed before the dot markers are removed — zero-gap transition.
  // AI : NOTE: This assumes the overlayRendering lazy chunk is already cached (import() resolves
  // AI : as a microtask). On the very first load, the module fetch spans multiple frames, so
  // AI : the rAF may fire before store-managed markers exist. In practice the first render
  // AI : always goes through the viewport manager path which preloads the chunk.
  // AI : promoteToStandalone=true re-adds dot markers as standalone layers on the map
  // AI : after destroying the layer group, keeping them visible during async image loading.
  pruneMapEntities();
  requestAnimationFrame(() => removeOverlayMarkers(true));
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
