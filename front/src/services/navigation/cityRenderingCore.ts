// Shared rendering primitives for city overlays and standalone markers.
// Used by both viewport-based loading (useViewportContentManager) and
// navigation-triggered loading (cityDataRenderer / projectNavigation).
// This module has no circular dependency risk: it only imports from stores,
// map primitives, and utility services — none of which import from this file.

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { addStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { createSingleMarker } from "@/services/overlay/overlayMarkers";
import { filterByStatus } from "@/services/overlay/statusFilters";
import type { OverlayData } from "@/types/index";
import {
  createProjectObject,
  createOverlayObject,
  type StandaloneProject,
} from "@/utils/typeFactories";

/**
 * Add standalone project markers for projects that have no visible overlays.
 * Unified version of the near-identical functions that existed in both
 * useViewportContentManager and cityDataRenderer.
 * Also unifies the 3-branch overlayCount type narrowing into one place.
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
    // Unified overlay count check spanning all StandaloneProject union members
    let overlayCount = 0;
    if ("overlayCount" in project) {
      overlayCount = project.overlayCount;
    } else if ("overlayIds" in project && Array.isArray(project.overlayIds)) {
      overlayCount = project.overlayIds.length;
    } else if ("overlays" in project && Array.isArray(project.overlays)) {
      overlayCount = project.overlays.length;
    }

    if (!projectIdsWithOverlays.has(project.id) && overlayCount === 0) {
      addStandaloneProjectMarkerForProject(
        createProjectObject(project as Parameters<typeof createProjectObject>[0]),
      );
    }
  }
}

/**
 * Helper to hydrate the store with a list of overlays and update their reactive properties
 */
export function hydrateOverlayStoreObjects(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const updates: Record<string, Partial<OverlayData>> = {};
  for (const overlayData of overlaysData) {
    if (overlayStore.overlays[overlayData.id]) {
      updates[overlayData.id] = {
        hasPendingChanges: overlayData.hasPendingChanges,
        suggestedCorners: overlayData.suggestedCorners,
        pendingChangeRequestsCount: overlayData.pendingChangeRequestsCount,
      };
    } else {
      // Instantiate an OverlayObject so that markers and interactions have a reactive target
      overlayStore.addOverlay(overlayData.id, createOverlayObject(overlayData));
    }
  }
  if (Object.keys(updates).length > 0) {
    overlayStore.batchUpdateOverlays(updates);
  }
}

/**
 * Shared utility to hydrate the Pinia store with fresh backend data.
 * Used by both full overlay rendering and marker-only rendering.
 */
function hydrateStoreWithOverlays(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  overlayStore.setViewModeOverlays(overlaysData);
  mapStore.currentCityOverlays = overlaysData;

  hydrateOverlayStoreObjects(overlaysData);

  updateOverlayMarkersColors(overlayStore.overlays, mapStore.mode);
}

/**
 * Render full overlay images (high zoom path).
 * Hydrates the store with fresh backend data, updates marker colors, then
 * delegates actual positioning to the pruning service.
 */
export function renderFullOverlays(overlaysData: OverlayData[]): void {
  hydrateStoreWithOverlays(overlaysData);

  const overlayStore = useOverlayStore();
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    createSingleMarker(overlayObject);
  }

  runViewportRenderLoop();
}

/**
 * Render overlay markers only (low zoom path).
 * Clears overlays to ensure a clean state, hydrates the store, and
 * creates interactive markers for each overlay.
 */
export function renderMarkersOnly(overlaysData: OverlayData[]): void {
  // CRITICAL: Must preserve store data! We only want to remove the image layers from map,
  // not destroy the reactive objects or clear the marker refs from the registry
  clearAllOverlays(true);

  hydrateStoreWithOverlays(overlaysData);

  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const mode = mapStore.mode;
  // Filter on OverlayData (has project field) so getOverlayMarkerColor can compute
  // the correct timeline-based color in view mode.
  const visibleIds = new Set(filterByStatus(overlaysData, mode).map((o) => o.id));
  for (const overlayObject of Object.values(overlayStore.overlays)) {
    if (visibleIds.has(overlayObject.id)) createSingleMarker(overlayObject);
  }
}
