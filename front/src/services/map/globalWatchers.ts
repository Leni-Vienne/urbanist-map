import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { getMapOrNull } from "@/services/core/map";
import {
  installEditHandleSync,
  watchEditHandles,
  syncEditHandlesForMode,
  syncEditHandlesForCurrentState,
} from "@/services/overlay/editing";
import { watchMarkerColors } from "@/services/overlay/markers";
import {
  installViewportRenderLoop,
  stopViewportRenderLoop,
  watchOverlayReconciliation,
} from "@/services/map/viewportRenderLoop";
import {
  watchViewportModeData,
  refreshEditSessionData,
  syncSessionDataForMode,
} from "@/services/map/viewportTriggers";
import {
  watchTileLayerState,
  syncTileLayerState,
  syncModeVectorFilters,
} from "@/services/map/tiles/layers";
import { watchMapAreaOutline, syncMapAreaOutline } from "@/services/map/mapAreaOutline";
import {
  syncProjectShapePreview,
  watchProjectShapePreview,
} from "@/services/map/shapes/previewCoordinator";
import { useUiStore } from "@/stores/uiStore";

function watchModeTransitions(): () => void {
  const uiStore = useUiStore();
  return watch(
    () => uiStore.mode,
    (newMode) => {
      syncEditHandlesForMode(newMode);
      void syncSessionDataForMode(newMode)
        .catch((error: unknown) => console.error("Mode session sync failed", error))
        .then(syncModeVectorFilters);
    },
  );
}

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
    watchProjectShapePreview(),
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
  await refreshEditSessionData();
  if (getMapOrNull() !== target) return;
  syncTileLayerState();
  syncMapAreaOutline();
  syncProjectShapePreview();
}
