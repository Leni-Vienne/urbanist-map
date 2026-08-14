import { watchModeTransitions } from "@/services/map/modeTransition";
import type { Map as MaplibreMap } from "maplibre-gl";
import { getMapOrNull } from "@/services/core/map";
import {
  installEditHandleSync,
  watchEditHandles,
  syncEditHandlesForCurrentState,
} from "@/services/overlay/editing";
import { watchMarkerColors } from "@/services/overlay/markers";
import {
  installViewportRenderLoop,
  stopViewportRenderLoop,
  watchOverlayReconciliation,
} from "@/services/map/viewportRenderLoop";
import { watchViewportModeData, refreshMapSessionData } from "@/services/map/viewportTriggers";
import { watchTileLayerState, syncTileLayerState } from "@/services/map/tiles/layers";
import { watchMapAreaOutline, syncMapAreaOutline } from "@/services/map/mapAreaOutline";

/**
 * Install the watchers and callback registrations owned by one MapView mount.
 * MapLibre layers may not exist when these watchers first run, so callbacks must guard layer access.
 */
export function startMapStateCoordinator(): () => void {
  const unregisterReconcile = installViewportRenderLoop();
  const unregisterEditHandleSync = installEditHandleSync();
  const stops = [
    watchModeTransitions(),
    watchEditHandles(),
    watchOverlayReconciliation(),
    watchMarkerColors(),
    watchViewportModeData(),
    watchTileLayerState(),
    watchMapAreaOutline(),
  ];

  let stopped = false;
  return function stopMapStateCoordinator(): void {
    if (stopped) return;
    stopped = true;
    for (const stop of stops.toReversed()) stop();
    unregisterReconcile();
    stopViewportRenderLoop();
    unregisterEditHandleSync();
  };
}

/** Project the retained application state onto a newly-ready map instance. */
export async function activateMapStateCoordinator(target: MaplibreMap): Promise<void> {
  if (getMapOrNull() !== target) return;
  syncEditHandlesForCurrentState();
  await refreshMapSessionData();
  if (getMapOrNull() !== target) return;
  syncTileLayerState();
  syncMapAreaOutline();
}
