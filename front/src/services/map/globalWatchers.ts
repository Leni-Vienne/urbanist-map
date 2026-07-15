import { watchModeTransitions } from "@/services/map/modeTransition";
import { watchEditHandles, syncEditHandlesForCurrentState } from "@/services/overlay/editing";
import { watchMarkerColors } from "@/services/overlay/markers";
import { watchShapeRendering } from "@/services/map/shapes/renderLoop";
import { watchOverlayReconciliation } from "@/services/map/viewportRenderLoop";
import { watchViewportModeData, refreshMapSessionData } from "@/services/map/viewportTriggers";
import { watchTileLayerState, syncTileLayerState } from "@/services/map/tiles/layers";
import { watchShapeHighlighting } from "@/services/map/projectDetailWatcher";

/**
 * Install the watchers and callback registrations owned by one MapView mount.
 * MapLibre layers may not exist when these watchers first run, so callbacks must guard layer access.
 */
export function startMapStateCoordinator(): () => void {
  const stops = [
    watchModeTransitions(),
    watchEditHandles(),
    watchOverlayReconciliation(),
    watchShapeRendering(),
    watchMarkerColors(),
    watchViewportModeData(),
    watchTileLayerState(),
    watchShapeHighlighting(),
  ];

  let stopped = false;
  return function stopMapStateCoordinator(): void {
    if (stopped) return;
    stopped = true;
    for (const stop of stops.toReversed()) stop();
  };
}

/** Project the retained application state onto a newly-ready map instance. */
export async function activateMapStateCoordinator(): Promise<void> {
  syncEditHandlesForCurrentState();
  await refreshMapSessionData();
  syncTileLayerState();
}
